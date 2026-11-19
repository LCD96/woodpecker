import { useLiveQuery } from "dexie-react-hooks";
import { db, type Puzzle } from "./db";

/** Mapa id -> puzzle del set de este dispositivo (undefined mientras carga) */
export function usePuzzleMap(): Map<string, Puzzle> | undefined {
  return useLiveQuery(async () => new Map((await db.puzzles.toArray()).map((p) => [p.id, p])), []);
}
