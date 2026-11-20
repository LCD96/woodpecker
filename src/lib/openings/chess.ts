import { Chess, DEFAULT_POSITION, type Square } from "chess.js";

export const START_FEN = DEFAULT_POSITION;

/** Identifica la posición: FEN sin los contadores de jugadas, para que las transposiciones coincidan */
export const posKey = (fen: string) => fen.split(" ").slice(0, 4).join(" ");
/** FEN completa a partir de una posKey (contadores ficticios) */
export const keyFen = (key: string) => `${key} 0 1`;

export const turnOf = (fen: string): "white" | "black" => (fen.split(" ")[1] === "w" ? "white" : "black");

export const parseUci = (u: string) => ({ from: u.slice(0, 2) as Square, to: u.slice(2, 4) as Square, promotion: u[4] });
export const uciPair = (u: string): [string, string] => [u.slice(0, 2), u.slice(2, 4)];

/** Aplica una jugada UCI; undefined si es ilegal */
export function play(fen: string, uci: string) {
  const c = new Chess(fen);
  try {
    const m = c.move(parseUci(uci));
    return { fen: c.fen(), san: m.san, uci: m.from + m.to + (m.promotion ?? "") };
  } catch { return undefined; }
}

export function dests(fen: string) {
  const m = new Map<string, string[]>();
  for (const mv of new Chess(fen).moves({ verbose: true })) m.set(mv.from, [...(m.get(mv.from) ?? []), mv.to]);
  return m;
}

/** UCI de lo que se ha movido en el tablero (promoción a dama salvo que `prefer` indique otra pieza) */
export function boardUci(fen: string, from: string, to: string, prefer?: string) {
  const p = new Chess(fen).get(from as Square);
  const promo = p?.type === "p" && (to[1] === "8" || to[1] === "1");
  if (!promo) return from + to;
  return from + to + (prefer?.startsWith(from + to) && prefer[4] ? prefer[4] : "q");
}

/** SAN de una línea de jugadas UCI desde `fen` (se corta en la primera ilegal) */
export function lineSan(fen: string, ucis: string[], max = 99) {
  const c = new Chess(fen); const out: string[] = [];
  for (const u of ucis.slice(0, max)) { try { out.push(c.move(parseUci(u)).san); } catch { break; } }
  return out;
}

/** Número de jugada para mostrar delante de un SAN ("12." o "12…") */
export function moveNo(fen: string) {
  const [, side, , , , n] = fen.split(" ");
  return side === "w" ? `${n}.` : `${n}…`;
}
