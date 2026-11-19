import Dexie, { type Table } from "dexie";
import bundledPuzzles from "../data/puzzles.json";

export interface Puzzle { id: string; fen: string; moves: string[]; rating: number; themes: string[]; }

export interface Attempt {
  id?: number;
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
  n: number;
  start: string;
  targetDays: number;
  order: string[];
  end?: string;
}

/** Repaso de un error (puzzle fallado o error de partida). No cuenta para el ciclo. */
export interface Review {
  id?: number;
  kind: "puzzle" | "game";
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

export interface Setting { key: string; value: unknown; }

class WoodpeckerDB extends Dexie {
  attempts!: Table<Attempt, number>;
  cycles!: Table<Cycle, number>;
  reviews!: Table<Review, number>;
  gameMistakes!: Table<GameMistake, string>;
  settings!: Table<Setting, string>;
  /** Set de puzzles del dispositivo. Viaja en las copias para que el ciclo sea idéntico en otro móvil. */
  puzzles!: Table<Puzzle, string>;
  constructor() {
    super("woodpecker");
    this.version(1).stores({ attempts: "++id, puzzleId, cycle", cycles: "n" });
    this.version(2).stores({
      attempts: "++id, puzzleId, cycle, date",
      cycles: "n",
      reviews: "++id, [kind+refId], date",
      gameMistakes: "id, gameId, date",
      settings: "key",
    });
    this.version(3).stores({ puzzles: "id" })
      .upgrade((tx) => tx.table("puzzles").bulkPut(bundledPuzzles));
    this.on("populate", (tx) => { tx.table("puzzles").bulkAdd(bundledPuzzles); });
  }
}
export const db = new WoodpeckerDB();
