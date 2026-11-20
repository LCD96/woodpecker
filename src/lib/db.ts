import Dexie, { type Table } from "dexie";
import dexieCloud from "dexie-cloud-addon";
import bundledPuzzles from "../data/puzzles.json";

// Base de datos v2, preparada para Dexie Cloud:
// - Claves de texto globalmente únicas (newId) o privadas por usuario ("#..."); nada de ++id ni claves numéricas.
// - Sin upgrade(): Dexie Cloud no admite migraciones en el cliente sobre tablas sincronizadas.
// La base antigua ("woodpecker") se importa una vez al arrancar (ver migrate.ts) y no se borra.

/** URL de la base de Dexie Cloud (npx dexie-cloud create). Sin ella la app funciona solo en local. */
export const CLOUD_URL: string | undefined = import.meta.env.VITE_DEXIE_CLOUD_URL || undefined;

export interface Puzzle { id: string; fen: string; moves: string[]; rating: number; themes: string[]; }

export interface Attempt {
  id: string;
  puzzleId: string;
  cycle: number;
  correct: boolean;
  firstMoveCorrect: boolean;
  timeMs: number;
  firstMoveMs: number;
  failedAtPly?: number;
  date: string;
}

export interface Cycle {
  id: string;                    // `#c${n}`: privado por usuario
  n: number;
  start: string;
  targetDays: number;
  order: string[];
  end?: string;
}

/** Repaso: puzzle fallado, error de partida o posición de apertura. No cuenta para el ciclo. */
export interface Review {
  id: string;
  kind: "puzzle" | "game" | "opening";
  refId: string;
  correct: boolean;
  timeMs: number;
  date: string;
}

/** Error (mistake/blunder) propio en una partida analizada de Lichess, convertido a puzzle */
export interface GameMistake {
  id: string;                    // `${gameId}-${ply}`
  gameId: string;
  ply: number;                   // índice de la jugada errónea (0 = 1. blancas)
  fen: string;                   // posición antes de la jugada previa del rival
  moves: [string, string];       // [jugada del rival (uci), mejor jugada (uci)]
  played: string;                // SAN de lo que jugaste
  best: string;                  // SAN de la mejor jugada
  judgment: "Mistake" | "Blunder";
  comment?: string;
  color: "white" | "black";
  opponent: string;
  speed: string;
  opening?: string;
  date: string;
}

/** Ajuste sincronizado; la clave lleva "#" delante (privada por usuario) */
export interface Setting { key: string; value: unknown; }

// ---------- Aperturas ----------

export interface Repertoire {
  id: string;
  name: string;
  color: "white" | "black";
  created: string;
}

/** Una jugada del repertorio (tuya o del rival). Las posiciones se identifican por posKey (FEN sin contadores). */
export interface RepMove {
  id: string;
  repId: string;
  from: string;                  // posKey antes de la jugada
  to: string;                    // posKey después
  uci: string;
  san: string;
  comment?: string;
  created: string;
}

/** Tarjeta de repaso espaciado (FSRS): una por posición en la que te toca mover */
export interface OpeningCard {
  id: string;                    // `${repId}|${posKey}`
  repId: string;
  pos: string;                   // posKey
  due: string;                   // ISO
  stability: number;
  difficulty: number;
  scheduled_days: number;
  learning_steps: number;
  reps: number;
  lapses: number;
  state: number;
  last_review?: string;
  /** Primera vez que se repasó: limita las posiciones nuevas por día */
  introduced?: string;
}

export interface EvalLine { uci: string; cp?: number; mate?: number; pv: string[]; }   // cp/mate desde las blancas
/** Caché de evaluaciones (local, no se sincroniza) */
export interface CachedEval { fen: string; depth: number; lines: EvalLine[]; source: "cloud" | "local"; }

class WoodpeckerDB extends Dexie {
  attempts!: Table<Attempt, string>;
  cycles!: Table<Cycle, string>;
  reviews!: Table<Review, string>;
  gameMistakes!: Table<GameMistake, string>;
  settings!: Table<Setting, string>;
  repertoires!: Table<Repertoire, string>;
  repMoves!: Table<RepMove, string>;
  cards!: Table<OpeningCard, string>;
  // Solo locales:
  /** Set de puzzles; es el mismo en todos los dispositivos (va en el código) y viaja en las copias */
  puzzles!: Table<Puzzle, string>;
  localSettings!: Table<Setting, string>;
  evals!: Table<CachedEval, string>;

  constructor() {
    super(CLOUD_URL ? "woodpecker-sync" : "woodpecker-local", { addons: CLOUD_URL ? [dexieCloud] : [] });
    this.version(1).stores({
      attempts: "id, puzzleId, cycle, date",
      cycles: "id, n",
      reviews: "id, [kind+refId], date",
      gameMistakes: "id, gameId, date",
      settings: "key",
      repertoires: "id",
      repMoves: "id, repId, [repId+from], [repId+to]",
      cards: "id, repId, due",
      puzzles: "id",
      localSettings: "key",
      evals: "fen",
    });
    if (CLOUD_URL) {
      this.cloud.configure({
        databaseUrl: CLOUD_URL,
        requireAuth: false,
        unsyncedTables: ["puzzles", "localSettings", "evals"],
      });
    }
    this.on("ready", async () => {
      if (!(await this.puzzles.count())) await this.puzzles.bulkPut(bundledPuzzles);
    });
  }
}
export const db = new WoodpeckerDB();

/** Identificador aleatorio de 20 caracteres. No usa crypto.randomUUID, que falta fuera de https. */
export function newId() {
  const abc = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
  return Array.from(crypto.getRandomValues(new Uint8Array(20)), (b) => abc[b % 62]).join("");
}

/** Identificador estable a partir de un texto (FNV-1a de 2×32 bits): misma entrada, mismo id en cualquier dispositivo */
export function stableId(prefix: string, text: string) {
  let h1 = 0x811c9dc5, h2 = 0x01000193 ^ 0x5bd1e995;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193);
    h2 = Math.imul(h2 ^ c, 0x5bd1e995) ^ (h2 >>> 13);
  }
  return `${prefix}${(h1 >>> 0).toString(36)}${(h2 >>> 0).toString(36)}`;
}

export const cycleId = (n: number) => `#c${n}`;
