// Conversión de datos antiguos (base "woodpecker" con ++id, copias v1–v3) al formato actual.
// La usan la migración automática al arrancar y la importación de copias.

import Dexie, { type Table } from "dexie";
import {
  CLOUD_URL, cycleId, db, stableId,
  type Attempt, type Cycle, type GameMistake, type OpeningCard, type Puzzle, type Repertoire, type RepMove, type Review, type Setting,
} from "./db";

/** Ajustes que se quedan en el dispositivo */
export const LOCAL_KEYS = new Set(["lichessToken"]);

export interface RawData {
  attempts?: Record<string, unknown>[];
  cycles?: Record<string, unknown>[];
  reviews?: Record<string, unknown>[];
  gameMistakes?: GameMistake[];
  settings?: Setting[];
  puzzles?: Puzzle[];
  repertoires?: Repertoire[];
  repMoves?: RepMove[];
  cards?: OpeningCard[];
}

/** Convierte al formato actual; las tablas que no vengan quedan undefined (no se tocan al importar) */
export function normalize(raw: RawData) {
  const settings = raw.settings?.map((s) => ({ ...s, key: s.key.replace(/^#/, "") }));
  return {
    attempts: raw.attempts?.map((a) => ({
      ...a, id: typeof a.id === "string" ? a.id : stableId("a", `${a.puzzleId}|${a.date}|${a.cycle}`),
    }) as Attempt),
    cycles: raw.cycles?.map((c) => ({ ...c, id: cycleId(c.n as number) }) as Cycle),
    reviews: raw.reviews?.map((r) => ({
      ...r, id: typeof r.id === "string" ? r.id : stableId("r", `${r.kind}|${r.refId}|${r.date}`),
    }) as Review),
    gameMistakes: raw.gameMistakes,
    settings: settings?.filter((s) => !LOCAL_KEYS.has(s.key)).map((s) => ({ ...s, key: `#${s.key}` })),
    localSettings: settings?.filter((s) => LOCAL_KEYS.has(s.key)),
    puzzles: raw.puzzles?.length ? raw.puzzles : undefined,
    repertoires: raw.repertoires,
    repMoves: raw.repMoves,
    cards: raw.cards,
  };
}

async function readDb(name: string): Promise<RawData | undefined> {
  if (!(await Dexie.exists(name))) return;
  const old = new Dexie(name);
  try {
    await old.open();                       // sin esquema: Dexie abre la versión que haya
    const out: Record<string, unknown[]> = {};
    for (const t of old.tables) out[t.name] = await t.toArray();
    return out as RawData;
  } finally { old.close(); }
}

/**
 * Al arrancar: si esta base está vacía, trae los datos de la base anterior (la de antes de la
 * sincronización, o la local si ahora hay nube). Solo una vez por dispositivo; el origen no se borra.
 */
export async function migrateOnce() {
  if (await db.localSettings.get("migrated")) return;
  let from: string | null = null;
  if (!(await db.attempts.count()) && !(await db.cycles.count()) && !(await db.repMoves.count())) {
    for (const name of CLOUD_URL ? ["woodpecker-local", "woodpecker"] : ["woodpecker"]) {
      const raw = await readDb(name).catch((e) => { console.warn(`Migration: can't read ${name}`, e); return undefined; });
      if (!raw?.attempts?.length && !raw?.cycles?.length && !raw?.repMoves?.length) continue;
      await writeAll(normalize(raw), false);
      from = name;
      break;
    }
  }
  await db.localSettings.put({ key: "migrated", value: { from, at: new Date().toISOString() } });
}

/**
 * Escribe los datos. Con `replace` (importar copia) cada tabla presente sustituye a la local;
 * las que la copia no trae se conservan. El token de Lichess nunca viaja en una copia.
 */
export async function writeAll(d: ReturnType<typeof normalize>, replace: boolean) {
  const synced: [Table, unknown[] | undefined][] = [
    [db.attempts, d.attempts], [db.cycles, d.cycles], [db.reviews, d.reviews], [db.gameMistakes, d.gameMistakes],
    [db.settings, d.settings], [db.repertoires, d.repertoires], [db.repMoves, d.repMoves], [db.cards, d.cards],
  ];
  await db.transaction("rw", [...synced.map(([t]) => t), db.localSettings, db.puzzles], async () => {
    const localUser = (await db.settings.get("#lichessUser"))?.value;
    for (const [t, rows] of synced) {
      if (!rows) continue;
      if (replace) await t.clear();
      await t.bulkPut(rows);
    }
    if (d.puzzles) { await db.puzzles.clear(); await db.puzzles.bulkPut(d.puzzles); }
    if (!replace && d.localSettings) await db.localSettings.bulkPut(d.localSettings);
    // El token local solo sirve si la copia es de la misma cuenta de Lichess
    if (replace && d.settings && d.settings.find((s) => s.key === "#lichessUser")?.value !== localUser) {
      await db.localSettings.delete("lichessToken");
    }
  });
}
