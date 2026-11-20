// PGN con variantes y comentarios: importación al repertorio y exportación.

import { Chess } from "chess.js";
import { START_FEN, play, posKey } from "./chess";
import type { Graph, NewMove } from "./repertoire";

const TOKEN = /\{[^}]*\}|;[^\n]*|\[[^\]]*\]|\(|\)|\$\d+|\d+\.(\.\.)?|1-0|0-1|1\/2-1\/2|\*|[^\s(){};[\]]+/g;

export interface ParsedPgn { moves: NewMove[]; games: number; skipped: number; errors: string[]; }

/** Todas las jugadas de todas las partidas/capítulos. Las partidas que no empiezan en la posición inicial se omiten. */
export function parsePgn(text: string): ParsedPgn {
  const out: ParsedPgn = { moves: [], games: 0, skipped: 0, errors: [] };
  // Se separa en partidas por las cabeceras: un bloque de [Tags] abre partida nueva
  const games = text.replace(/\r/g, "").split(/\n\s*\n(?=\s*\[)/);
  for (const g of games) {
    if (!g.trim()) continue;
    const fenTag = g.match(/\[FEN\s+"([^"]+)"\]/)?.[1];
    if (fenTag && posKey(fenTag) !== posKey(START_FEN)) { out.skipped++; continue; }
    out.games++;
    parseGame(g, out);
  }
  return out;
}

function parseGame(text: string, out: ParsedPgn) {
  // Estado de la línea actual: posición antes y después de la última jugada.
  // Tras una jugada ilegal la línea queda "muerta" hasta cerrar su variante.
  let before = START_FEN, after = START_FEN, dead = false;
  let last: NewMove | undefined;
  const stack: { before: string; after: string; dead: boolean; last?: NewMove }[] = [];
  for (const tok of text.match(TOKEN) ?? []) {
    if (tok.startsWith("[") || tok.startsWith(";") || tok.startsWith("$") || /^\d+\.(\.\.)?$/.test(tok)) continue;
    if (["1-0", "0-1", "1/2-1/2", "*"].includes(tok)) continue;
    if (tok.startsWith("{")) {
      const c = tok.slice(1, -1).replace(/\[%[^\]]*\]/g, "").trim();   // fuera [%clk], [%eval]…
      if (c && last && !dead) last.comment = last.comment ? `${last.comment} ${c}` : c;
      continue;
    }
    if (tok === "(") { stack.push({ before, after, dead, last }); after = before; last = undefined; continue; }
    if (tok === ")") { const st = stack.pop(); if (st) ({ before, after, dead, last } = st); continue; }
    if (dead) continue;
    const san = tok.replace(/^\d+\.+/, "").replace(/[!?]+$/, "");
    if (!san) continue;
    const c = new Chess(after);
    try {
      const m = c.move(san);
      last = { from: after, uci: m.from + m.to + (m.promotion ?? "") };
      out.moves.push(last);
      before = after; after = c.fen();
    } catch {
      if (out.errors.length < 5) out.errors.push(`Illegal move "${tok}"`);
      dead = true;
    }
  }
}

/** PGN del repertorio: línea principal = jugada más antigua; las demás, variantes. Las transposiciones no se repiten. */
export function exportPgn(g: Graph) {
  const seen = new Set<string>();
  const san = (fen: string, uci: string) => play(fen, uci)?.san ?? uci;
  const num = (fen: string, force: boolean) => {
    const [, side, , , , n] = fen.split(" ");
    return side === "w" ? `${n}. ` : force ? `${n}... ` : "";
  };
  const comment = (c?: string) => (c ? ` {${c.replace(/[{}]/g, "")}}` : "");

  // Escribe la secuencia desde `fen`; `force` = hace falta número antes de una jugada de negras
  const line = (fen: string, force: boolean): string => {
    const key = posKey(fen);
    const kids = g.byFrom.get(key) ?? [];
    if (!kids.length) return "";
    if (seen.has(key)) return " {transposes}";
    seen.add(key);
    const [main, ...alts] = kids;
    const mainAfter = play(fen, main.uci)!.fen;
    let s = ` ${num(fen, force)}${san(fen, main.uci)}${comment(main.comment)}`;
    for (const a of alts) {
      const aAfter = play(fen, a.uci)!.fen;
      s += ` (${num(fen, true)}${san(fen, a.uci)}${comment(a.comment)}${line(aAfter, !!a.comment)})`;
    }
    return s + line(mainAfter, alts.length > 0 || !!main.comment);
  };

  const color = g.rep.color === "white" ? "White" : "Black";
  return `[Event "${g.rep.name.replace(/"/g, "'")}"]\n[Site "Woodpecker"]\n[White "${color === "White" ? "Me" : "?"}"]\n[Black "${color === "Black" ? "Me" : "?"}"]\n[Result "*"]\n\n${line(START_FEN, false).trim()} *\n`;
}
