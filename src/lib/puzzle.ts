import { Chess, type Square } from "chess.js";
import type { Puzzle } from "./db";

export const parseUci = (u: string) =>
  ({ from: u.slice(0, 2) as Square, to: u.slice(2, 4) as Square, promotion: u[4] });

export class PuzzleRun {
  puzzle: Puzzle;
  game: Chess;
  ply = 1;                       // índice en puzzle.moves; el 0 es la jugada del rival
  /** Color del usuario: el contrario del que mueve en la FEN inicial */
  readonly orientation: "white" | "black";
  constructor(puzzle: Puzzle) {
    this.puzzle = puzzle;
    this.game = new Chess(puzzle.fen);
    this.orientation = this.game.turn() === "w" ? "black" : "white";
  }
  playOpponentIntro() { this.game.move(parseUci(this.puzzle.moves[0])); }

  /** Jugadas legales en el formato que pide Chessground */
  dests(): Map<string, string[]> {
    const m = new Map<string, string[]>();
    for (const mv of this.game.moves({ verbose: true })) {
      m.set(mv.from, [...(m.get(mv.from) ?? []), mv.to]);
    }
    return m;
  }

  /**
   * Comprueba la jugada del usuario. Con "continue" la respuesta del rival queda pendiente:
   * llama a playReply() tras una pausa para que se vea primero tu jugada y luego la suya.
   */
  tryMove(from: string, to: string): "continue" | "solved" | "failed" {
    const expected = this.puzzle.moves[this.ply];
    // Promociones: si coincide con la solución usa su pieza; si no, dama
    const promo = expected.startsWith(from + to) ? expected[4] : "q";
    const uci = from + to + (this.isPromotion(from, to) ? promo : "");
    const lastMove = this.ply === this.puzzle.moves.length - 1;

    const test = new Chess(this.game.fen());
    test.move(parseUci(uci));
    const mateAlternativo = lastMove && test.isCheckmate();   // cualquier mate vale en la última jugada

    if (uci !== expected && !mateAlternativo) return "failed";
    this.game.move(parseUci(uci));
    this.ply++;
    if (this.ply >= this.puzzle.moves.length) return "solved";
    return "continue";
  }

  /** Juega la respuesta del rival y devuelve su jugada UCI */
  playReply() {
    const m = this.puzzle.moves[this.ply++];
    this.game.move(parseUci(m));
    return m;
  }

  private isPromotion(from: string, to: string) {
    const p = this.game.get(from as Square);
    return p?.type === "p" && (to[1] === "8" || to[1] === "1");
  }
}