// Planes típicos desde una posición, sacados de partidas reales que pasaron por ella:
// maestros (hasta 15) y, con sesión de Lichess, partidas a tu nivel. En cada partida se sigue a cada pieza
// del bando elegido durante las siguientes jugadas y se cuenta adónde va primero, cómo se enroca, qué rupturas hay.

import { Chess, type Square } from "chess.js";
import { posKey } from "./chess";
import { explore, type ExplorerGame } from "./explorer";
import { getSettings } from "../settings";

const WINDOW = 24;            // medias jugadas que se siguen desde la posición

export interface PlanItem {
  /** Texto con trozos resaltados: los impares van en color */
  parts: string[];
  arrows: { orig: string; dest: string }[];
  share: number;
}
export interface Plan { side: "white" | "black"; games: number; items: PlanItem[]; }

const cache = new Map<string, Promise<Plan>>();

export function getPlan(fen: string, side: "white" | "black") {
  const k = `${posKey(fen)}|${side}`;
  let p = cache.get(k);
  if (!p) { p = buildPlan(fen, side); cache.set(k, p); p.catch(() => cache.delete(k)); }
  return p;
}

async function buildPlan(fen: string, side: "white" | "black"): Promise<Plan> {
  const games = await sampleGames(fen);
  const stats = collect(fen, side, games);
  return { side, games: stats.games, items: describe(fen, side, stats) };
}

// ---------- Partidas ----------

async function sampleGames(fen: string): Promise<string[][]> {
  const out: string[][] = [];
  const masters = await explore(fen, "masters", true).catch(() => undefined);
  const ids = (masters?.topGames ?? []).map((g) => g.id);
  // Con 4 a la vez para no saturar el explorador
  for (let i = 0; i < ids.length; i += 4) {
    const pgns = await Promise.all(ids.slice(i, i + 4).map((id) =>
      fetch(`https://explorer.lichess.ovh/masters/pgn/${id}`).then((r) => (r.ok ? r.text() : ""), () => "")));
    for (const pgn of pgns) { const m = sanMoves(pgn); if (m.length) out.push(m); }
  }
  if ((await getSettings()).lichessToken) {
    const lichess = await explore(fen, "lichess", true).catch(() => undefined);
    const lids = [...(lichess?.topGames ?? []), ...(lichess?.recentGames ?? [])].map((g: ExplorerGame) => g.id);
    if (lids.length) {
      const res = await fetch("https://lichess.org/api/games/export/_ids?moves=true&tags=false&clocks=false&evals=false&opening=false", {
        method: "POST", body: lids.join(","), headers: { Accept: "application/x-ndjson" },
      }).catch(() => undefined);
      if (res?.ok) {
        for (const line of (await res.text()).split("\n")) {
          if (!line.trim()) continue;
          try { const g = JSON.parse(line) as { moves?: string }; if (g.moves) out.push(g.moves.split(" ")); } catch { /* línea rara */ }
        }
      }
    }
  }
  return out;
}

function sanMoves(pgn: string) {
  return pgn.replace(/\[[^\]]*\]/g, "").replace(/\{[^}]*\}/g, "").split(/\s+/)
    .filter((t) => t && !/^\d+\.+$/.test(t) && !["1-0", "0-1", "1/2-1/2", "*"].includes(t))
    .map((t) => t.replace(/^\d+\.+/, ""));
}

// ---------- Estadística ----------

interface FirstMove { to: string; captured?: string; san: string; }
interface Stats {
  games: number;
  castle: { k: number; q: number; none: number };
  /** pieza (por su casilla en la posición de partida) → primeras jugadas */
  first: Map<string, FirstMove[]>;
}

function collect(fen: string, side: "white" | "black", games: string[][]): Stats {
  const key = posKey(fen);
  const me = side === "white" ? "w" : "b";
  const st: Stats = { games: 0, castle: { k: 0, q: 0, none: 0 }, first: new Map() };
  for (const moves of games) {
    const c = new Chess();
    let i = 0;
    // Avanza hasta la posición (puede llegar por otro orden de jugadas)
    for (; i < moves.length && posKey(c.fen()) !== key; i++) { try { c.move(moves[i]); } catch { i = moves.length; } }
    if (posKey(c.fen()) !== key) continue;
    st.games++;
    // casilla actual → identidad de la pieza (su casilla en la posición de partida)
    const where = new Map<string, string>();
    for (const row of c.board()) for (const p of row) if (p && p.color === me) where.set(p.square, p.square);
    const moved = new Set<string>();
    let castled: "k" | "q" | undefined;
    for (let n = 0; n < WINDOW && i < moves.length; n++, i++) {
      let m;
      try { m = c.move(moves[i]); } catch { break; }
      if (m.color === me) {
        const id = where.get(m.from);
        where.delete(m.from);
        if (id) where.set(m.to, id);
        if (m.isKingsideCastle() || m.isQueensideCastle()) {
          castled = m.isKingsideCastle() ? "k" : "q";
          const rank = me === "w" ? "1" : "8";
          const [rf, rt] = castled === "k" ? [`h${rank}`, `f${rank}`] : [`a${rank}`, `d${rank}`];
          const rid = where.get(rf); where.delete(rf); if (rid) { where.set(rt, rid); moved.add(rid); }
          if (id) moved.add(id);
          continue;
        }
        if (id && !moved.has(id)) {
          moved.add(id);
          st.first.set(id, [...(st.first.get(id) ?? []), { to: m.to, captured: m.captured, san: m.san }]);
        }
      } else if (m.captured) {
        // El rival captura una de las nuestras (al paso, el peón está detrás de la casilla de destino)
        const sq = m.isEnPassant() ? `${m.to[0]}${m.from[1]}` : m.to;
        where.delete(sq);
      }
    }
    st.castle[castled ?? "none"]++;
  }
  return st;
}

// ---------- Texto ----------

const NAMES: Record<string, string> = { q: "queen", r: "rook", b: "bishop", n: "knight", k: "king", p: "pawn" };
const PIECE_OF: Record<string, string> = { q: "queen", r: "rook", b: "bishop", n: "knight", p: "pawn", k: "king" };
const isLight = (sq: string) => (sq.charCodeAt(0) - 97 + +sq[1]) % 2 === 0;

function describe(fen: string, side: "white" | "black", st: Stats): PlanItem[] {
  if (st.games < 3) return [];
  const c = new Chess(fen);
  const me = side === "white" ? "w" : "b";
  const Side = side === "white" ? "White" : "Black";
  const home = me === "w" ? "1" : "8";
  const items: PlanItem[] = [];
  const pct = (x: number) => `${Math.round(x * 100)}%`;

  // Enroque, si aún se puede
  const rights = fen.split(" ")[2];
  const canK = rights.includes(me === "w" ? "K" : "k"), canQ = rights.includes(me === "w" ? "Q" : "q");
  const { k, q, none } = st.castle;
  if (canK || canQ) {
    const best = k >= q ? "k" : "q";
    const share = Math.max(k, q) / st.games;
    if (share >= 0.4) {
      items.push({
        parts: [`${Side} ${share >= 0.6 ? "typically" : "often"} `, `castles ${best === "k" ? "kingside" : "queenside"}`, ` (${pct(share)})`],
        arrows: [{ orig: `e${home}`, dest: `${best === "k" ? "g" : "c"}${home}` }], share,
      });
    } else if (none / st.games >= 0.5) {
      items.push({ parts: [`${Side} often `, "delays castling", ""], arrows: [], share: none / st.games });
    }
  }

  const name = (sq: string) => {
    const p = c.get(sq as Square)!;
    if (p.type === "n" && sq[1] === home && (sq[0] === "b" || sq[0] === "g")) return `the ${sq[0] === "g" ? "kingside" : "queenside"} knight`;
    if (p.type === "b") return `the ${isLight(sq) ? "light" : "dark"}-squared bishop`;
    if (p.type === "r" && sq[1] === home && (sq[0] === "a" || sq[0] === "h")) return `the ${sq[0] === "h" ? "kingside" : "queenside"} rook`;
    if (p.type === "q") return "the queen";
    return `the ${NAMES[p.type]} on ${sq}`;
  };
  const cap = (s: string) => s[0].toUpperCase() + s.slice(1);

  const pieces: PlanItem[] = [], pawnPushes: { san: string; to: string; from: string; share: number }[] = [];
  for (const [id, moves] of st.first) {
    const p = c.get(id as Square);
    if (!p || p.type === "k") continue;
    const rate = moves.length / st.games;
    if (rate < 0.35) continue;
    const byTo = new Map<string, FirstMove[]>();
    for (const m of moves) byTo.set(m.to, [...(byTo.get(m.to) ?? []), m]);
    const tops = [...byTo].sort((a, b) => b[1].length - a[1].length);
    const [topTo, topMoves] = tops[0];
    const topShare = topMoves.length / moves.length;

    if (p.type === "p") {
      if (topMoves[0].captured && topShare >= 0.4) {
        pieces.push({
          parts: [`The pawn on ${id} generally `, `captures the ${PIECE_OF[topMoves[0].captured]} on ${topTo}`, ""],
          arrows: [{ orig: id, dest: topTo }], share: rate * topShare,
        });
      } else if (!topMoves[0].captured && topShare >= 0.4) {
        pawnPushes.push({ san: topTo, to: topTo, from: id, share: rate * topShare });
      }
      continue;
    }
    const alts = tops.filter(([, ms], i) => i === 0 || ms.length / moves.length >= 0.25).slice(0, 2);
    const usually = topShare >= 0.6;
    const verb = alts.every(([, ms]) => ms[0].captured) ? (usually ? "captures on" : "capture on")
      : id[1] === home ? (usually ? "develops to" : "develop to") : (usually ? "goes to" : "go to");
    const where = alts.map(([to]) => to);
    pieces.push({
      parts: [`${cap(name(id))} ${usually ? "usually" : "can"} ${verb} `, where.length > 1 ? `${where[0]} or ${where[1]}` : where[0], ""],
      arrows: where.map((to) => ({ orig: id, dest: to })), share: rate * topShare,
    });
  }
  items.push(...pieces.sort((a, b) => b.share - a.share).slice(0, 4));
  if (pawnPushes.length) {
    const top = pawnPushes.sort((a, b) => b.share - a.share).slice(0, 3);
    items.push({
      parts: [top.length > 1 ? "Common pawn moves are " : "A common pawn move is ",
        top.length > 1 ? `${top.slice(0, -1).map((x) => x.san).join(", ")} and ${top.at(-1)!.san}` : top[0].san, ""],
      arrows: top.map((x) => ({ orig: x.from, dest: x.to })), share: top[0].share,
    });
  }
  return items;
}
