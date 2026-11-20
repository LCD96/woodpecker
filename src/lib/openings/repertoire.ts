// Repertorio como grafo de posiciones: cada RepMove une dos posKey. Las transposiciones comparten nodo.
// Hay una tarjeta de repaso por cada posición en la que te toca mover y tienes al menos una jugada.

import { db, newId, type Repertoire, type RepMove } from "../db";
import { START_FEN, play, posKey, turnOf } from "./chess";
import { cardId, isNew, newCard, sessionCards } from "./srs";

export const START = posKey(START_FEN);

export interface Graph {
  rep: Repertoire;
  moves: RepMove[];
  byFrom: Map<string, RepMove[]>;
}

export function buildGraph(rep: Repertoire, moves: RepMove[]): Graph {
  const byFrom = new Map<string, RepMove[]>();
  for (const m of [...moves].sort((a, b) => a.created.localeCompare(b.created))) {
    byFrom.set(m.from, [...(byFrom.get(m.from) ?? []), m]);
  }
  return { rep, moves, byFrom };
}

export async function loadGraph(repId: string) {
  const rep = await db.repertoires.get(repId);
  return rep && buildGraph(rep, await db.repMoves.where("repId").equals(repId).toArray());
}

/** ¿Me toca mover en esta posición? */
export const isMine = (rep: Repertoire, key: string) => turnOf(key) === rep.color;

/** Posiciones alcanzables desde la inicial */
export function reachable(g: Graph) {
  const seen = new Set([START]), queue = [START];
  while (queue.length) {
    for (const m of g.byFrom.get(queue.shift()!) ?? []) {
      if (!seen.has(m.to)) { seen.add(m.to); queue.push(m.to); }
    }
  }
  return seen;
}

/**
 * Camino más corto (en jugadas del repertorio) desde `from` hasta la primera posición que cumpla `goal`.
 * Devuelve las jugadas, [] si `from` ya cumple, o undefined si no se llega.
 */
export function pathTo(g: Graph, from: string, goal: (key: string) => boolean): RepMove[] | undefined {
  const prev = new Map<string, RepMove | null>([[from, null]]);
  const queue = [from];
  while (queue.length) {
    const k = queue.shift()!;
    if (goal(k)) {
      const out: RepMove[] = [];
      for (let m = prev.get(k); m; m = prev.get(m.from)) out.unshift(m);
      return out;
    }
    for (const m of g.byFrom.get(k) ?? []) if (!prev.has(m.to)) { prev.set(m.to, m); queue.push(m.to); }
  }
}

export async function createRepertoire(name: string, color: "white" | "black") {
  const rep: Repertoire = { id: newId(), name: name.trim() || `${color === "white" ? "White" : "Black"} repertoire`, color, created: new Date().toISOString() };
  await db.repertoires.add(rep);
  return rep;
}

export async function deleteRepertoire(id: string) {
  await db.transaction("rw", db.repertoires, db.repMoves, db.cards, async () => {
    await db.repMoves.where("repId").equals(id).delete();
    await db.cards.where("repId").equals(id).delete();
    await db.repertoires.delete(id);
  });
}

export interface NewMove { from: string; uci: string; comment?: string; }

/**
 * Añade jugadas (fen completa de partida + uci). Las que ya existen solo suman el comentario.
 * Con `onlyMainForMe`, si ya tienes jugada en esa posición no se añade otra tuya.
 */
export async function addMoves(rep: Repertoire, moves: NewMove[], onlyMainForMe = false) {
  return db.transaction("rw", db.repMoves, db.cards, async () => {
    const existing = await db.repMoves.where("repId").equals(rep.id).toArray();
    const byKey = new Map(existing.map((m) => [`${m.from} ${m.uci}`, m]));
    const mineAt = new Set(existing.filter((m) => isMine(rep, m.from)).map((m) => m.from));
    const put: RepMove[] = [];
    let added = 0;
    for (const nm of moves) {
      const r = play(nm.from, nm.uci);
      if (!r) continue;
      const from = posKey(nm.from), k = `${from} ${r.uci}`;
      const old = byKey.get(k);
      if (old) {
        if (nm.comment && !old.comment?.includes(nm.comment)) {
          old.comment = old.comment ? `${old.comment}\n${nm.comment}` : nm.comment;
          put.push(old);
        }
        continue;
      }
      if (onlyMainForMe && isMine(rep, from) && mineAt.has(from)) continue;
      const m: RepMove = {
        id: newId(), repId: rep.id, from, to: posKey(r.fen), uci: r.uci, san: r.san,
        comment: nm.comment || undefined, created: new Date(Date.now() + added).toISOString(),   // conserva el orden
      };
      byKey.set(k, m);
      if (isMine(rep, from)) mineAt.add(from);
      put.push(m);
      added++;
    }
    await db.repMoves.bulkPut(put);
    // Tarjeta para cada posición nueva en la que te toca mover
    const ids = [...mineAt].map((p) => cardId(rep.id, p));
    const have = new Set((await db.cards.bulkGet(ids)).filter(Boolean).map((c) => c!.id));
    await db.cards.bulkPut([...mineAt].filter((p) => !have.has(cardId(rep.id, p))).map((p) => newCard(rep.id, p)));
    return added;
  });
}

/** Borra una jugada y todo lo que deja de ser alcanzable desde la posición inicial */
export const deleteMove = (rep: Repertoire, id: string) => deleteMoves(rep, [id]);

/** Borra jugadas y todo lo que solo se alcanzaba a través de ellas */
export async function deleteMoves(rep: Repertoire, ids: string[]) {
  await db.transaction("rw", db.repMoves, db.cards, async () => {
    await db.repMoves.bulkDelete(ids);
    const g = buildGraph(rep, await db.repMoves.where("repId").equals(rep.id).toArray());
    const live = reachable(g);
    await db.repMoves.bulkDelete(g.moves.filter((m) => !live.has(m.from)).map((m) => m.id));
    const withMine = new Set(g.moves.filter((m) => live.has(m.from) && isMine(rep, m.from)).map((m) => m.from));
    const cards = await db.cards.where("repId").equals(rep.id).toArray();
    await db.cards.bulkDelete(cards.filter((c) => !withMine.has(c.pos)).map((c) => c.id));
  });
}

export const setComment = (id: string, comment: string) => db.repMoves.update(id, { comment: comment.trim() || undefined });
export const renameRepertoire = (id: string, name: string) => db.repertoires.update(id, { name });

/** Resumen de cada repertorio para listas: jugadas, posiciones, pendientes de hoy y nuevas */
export async function repertoireSummaries(newPerDay: number) {
  const [reps, moves, cards] = await Promise.all([db.repertoires.toArray(), db.repMoves.toArray(), db.cards.toArray()]);
  return reps.sort((a, b) => a.created.localeCompare(b.created)).map((rep) => {
    const g = buildGraph(rep, moves.filter((m) => m.repId === rep.id));
    const live = reachable(g);
    const mineAt = new Set(g.moves.filter((m) => isMine(rep, m.from)).map((m) => m.from));
    const repCards = cards.filter((c) => c.repId === rep.id && live.has(c.pos) && mineAt.has(c.pos));
    const { due, fresh } = sessionCards(repCards, cards, newPerDay);
    return { rep, moves: g.moves.length, positions: repCards.length, unseen: repCards.filter(isNew).length, due: due.length, fresh: fresh.length };
  });
}
