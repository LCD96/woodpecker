// Estado del tablero de repaso tras un puzzle: recorre la solución, permite probar jugadas propias
// (crean una variante) y, con `engine`, analiza cada posición con Stockfish.
// Es un hook (no un componente) para que el puzzle y el repaso compartan el mismo <Board>
// y el tablero no se vuelva a montar al terminar.

import { useCallback, useEffect, useMemo, useState } from "react";
import { Chess, type Square } from "chess.js";
import { engine, type EngineLine } from "./engine";

const uciMove = (u: string) => ({ from: u.slice(0, 2) as Square, to: u.slice(2, 4) as Square, promotion: u[4] });

interface Options {
  startFen: string;
  solution: string[];          // jugadas UCI desde startFen
  active: boolean;
  engine: boolean;
}

export function useExplorer({ startFen, solution, active, engine: engineOn }: Options) {
  const [moves, setMoves] = useState(solution);
  const [cursor, setCursorRaw] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [analysis, setAnalysis] = useState<{ fen: string; lines: EngineLine[] }>();

  const { fens, sans } = useMemo(() => {
    const c = new Chess(startFen);
    const fens = [c.fen()], sans: string[] = [];
    for (const m of moves) { sans.push(c.move(uciMove(m)).san); fens.push(c.fen()); }
    return { fens, sans };
  }, [startFen, moves]);

  const fen = fens[Math.min(cursor, fens.length - 1)];
  const pos = useMemo(() => new Chess(fen), [fen]);
  const dests = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const mv of pos.moves({ verbose: true })) m.set(mv.from, [...(m.get(mv.from) ?? []), mv.to]);
    return m;
  }, [pos]);

  /** Navegación manual: siempre cancela la reproducción automática */
  const goTo = useCallback((c: number) => {
    setPlaying(false);
    setCursorRaw(Math.max(0, Math.min(moves.length, c)));
  }, [moves.length]);

  /** Reproduce la solución desde `from` hasta el final (una sola vez) */
  const playFrom = (from: number) => { setMoves(solution); setCursorRaw(from); setPlaying(true); };

  useEffect(() => {
    if (!playing) return;
    const t = setTimeout(() => {
      if (cursor >= moves.length) setPlaying(false);
      else setCursorRaw(cursor + 1);
    }, 700);
    return () => clearTimeout(t);
  }, [playing, cursor, moves.length]);

  useEffect(() => {
    if (!active || !engineOn || pos.isGameOver()) return;
    engine.analyse(fen, (f, ls) => { if (f === fen) setAnalysis({ fen, lines: [...ls] }); });
    return () => engine.stop();
  }, [active, engineOn, fen, pos]);

  const play = useCallback((uci: string) => {
    setPlaying(false);
    if (moves[cursor] === uci) { setCursorRaw(cursor + 1); return; }
    setMoves([...moves.slice(0, cursor), uci]);
    setCursorRaw(cursor + 1);
  }, [moves, cursor]);

  const onMove = useCallback((from: string, to: string) => {
    const p = pos.get(from as Square);
    const promo = p?.type === "p" && (to[1] === "8" || to[1] === "1") ? "q" : "";
    play(from + to + promo);
  }, [pos, play]);

  useEffect(() => {
    if (!active) return;
    const k = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft") goTo(cursor - 1);
      if (e.key === "ArrowRight") goTo(cursor + 1);
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [active, cursor, goTo]);

  const startNo = Number(startFen.split(" ")[5] ?? 1), blackFirst = startFen.split(" ")[1] === "b";
  const moveLabel = (i: number) => {
    const ply = i + (blackFirst ? 1 : 0);
    return ply % 2 === 0 ? `${startNo + Math.floor(ply / 2)}.` : i === 0 ? `${startNo}…` : "";
  };
  const deviates = moves.findIndex((m, i) => m !== solution[i]);
  const lines = engineOn && analysis?.fen === fen ? analysis.lines : [];
  const pvSan = (l: EngineLine) => {
    const c = new Chess(fen); const out: string[] = [];
    for (const m of l.pv.slice(0, 10)) { try { out.push(c.move(uciMove(m)).san); } catch { break; } }
    return out.join(" ");
  };
  const last = cursor > 0 ? moves[cursor - 1] : undefined;

  return {
    fen, pos, dests, cursor, moves, sans, playing, lines, deviates, engineOn,
    lastMove: last ? [last.slice(0, 2), last.slice(2, 4)] as [string, string] : undefined,
    goTo, playFrom, play, onMove, moveLabel, pvSan,
    backToSolution: () => { setPlaying(false); setMoves(solution); setCursorRaw(Math.min(cursor, deviates)); },
  };
}

export type ExplorerState = ReturnType<typeof useExplorer>;
