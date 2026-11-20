// Flujo:
// 1. Muestra la posición inicial
// 2. Tras ~500 ms: run.playOpponentIntro() y arranca el reloj (visible en pantalla)
// 3. onMove(from, to) -> run.tryMove(from, to)
//      "continue": muestra tu jugada y, tras REPLY_DELAY, la respuesta del rival (el reloj se pausa mientras)
//      "solved" / "failed": para el reloj y avisa con onResult
// 4. Al terminar, el mismo <Board> pasa a manejarlo useExplorer: "Show solution" (solo si fallas) reproduce la solución,
//    "Analyse" activa Stockfish, y se puede navegar o probar jugadas libremente.
// Monta con key={puzzle.id} para reiniciar el estado en cada puzzle.

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Chess, type Square } from "chess.js";
import { Board } from "./Board";
import { EngineLines, EvalBar, ExplorerControls, LichessLink, MoveStrip } from "./Explorer";
import { useExplorer } from "../lib/useExplorer";
import type { Puzzle } from "../lib/db";
import { PuzzleRun, parseUci } from "../lib/puzzle";

const uciPair = (u: string): [string, string] => [u.slice(0, 2), u.slice(2, 4)];

export interface SolveResult {
  correct: boolean;
  firstMoveCorrect: boolean;
  timeMs: number;
  firstMoveMs: number;
  failedAtPly?: number;
}

type Status = "intro" | "playing" | "solved" | "failed";
interface View { fen: string; dests: Map<string, string[]>; lastMove?: [string, string]; }

interface Props {
  puzzle: Puzzle;
  onResult: (r: SolveResult) => void;
  onNext?: () => void;
  /** Texto bajo el tablero cuando se falla (p. ej. "In the game you played Qxd5") */
  failHint?: ReactNode;
}

/** Pausa antes de la respuesta del rival, para que se vean las dos jugadas por separado */
const REPLY_DELAY = 500;

const fmtClock = (ms: number) => {
  const s = ms / 1000;
  return `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, "0")}`;
};

export function PuzzleSolver({ puzzle, onResult, onNext, failHint }: Props) {
  const [run] = useState(() => new PuzzleRun(puzzle));
  const [status, setStatus] = useState<Status>("intro");
  const [view, setView] = useState<View>(() => ({ fen: run.game.fen(), dests: new Map() }));
  const [elapsed, setElapsed] = useState(0);
  const [wrong, setWrong] = useState<{ played: string; correct: string }>();
  const [analyse, setAnalyse] = useState(false);
  const [endCursor, setEndCursor] = useState(0);
  // Posición tras la jugada del rival: punto de partida del repaso
  const [startFen] = useState(() => { const c = new Chess(puzzle.fen); c.move(parseUci(puzzle.moves[0])); return c.fen(); });
  const finished = status === "solved" || status === "failed";
  const ex = useExplorer({ startFen, solution: puzzle.moves.slice(1), active: finished, engine: analyse });
  const t0 = useRef(0), firstMoveMs = useRef<number | null>(null);
  const replyTimer = useRef<number | undefined>(undefined);
  const [waiting, setWaiting] = useState(false);     // esperando la respuesta del rival

  // run es mutable: tras cada jugada copiamos su estado a la vista
  const sync = (lastMove?: [string, string], movable = false) =>
    setView({ fen: run.game.fen(), dests: movable ? run.dests() : new Map(), lastMove });

  useEffect(() => {
    const t = setTimeout(() => {
      run.playOpponentIntro();
      sync(uciPair(puzzle.moves[0]), true);
      t0.current = performance.now(); firstMoveMs.current = null;
      setStatus("playing");
    }, 500);
    return () => { clearTimeout(t); clearTimeout(replyTimer.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (status !== "playing" || waiting) return;
    const i = setInterval(() => setElapsed(performance.now() - t0.current), 100);
    return () => clearInterval(i);
  }, [status, waiting]);

  const onMove = useCallback((from: string, to: string) => {
    if (status !== "playing" || waiting) return;
    if (firstMoveMs.current === null) firstMoveMs.current = performance.now() - t0.current;
    const fenBefore = run.game.fen();
    const res = run.tryMove(from, to);
    if (res === "continue") {
      // Un solo cambio por actualización: si tu jugada y la respuesta llegan juntas, chessground
      // da tu pieza por capturada a mitad de animación y el tablero parpadea
      sync([from, to]);
      setWaiting(true);
      const pauseStart = performance.now();
      replyTimer.current = setTimeout(() => {
        const reply = run.playReply();
        t0.current += performance.now() - pauseStart;
        sync(uciPair(reply), true);
        setWaiting(false);
      }, REPLY_DELAY);
      return;
    }

    const timeMs = performance.now() - t0.current;
    setElapsed(timeMs);
    if (res === "failed") {
      const pos = new Chess(fenBefore);
      const exp = puzzle.moves[run.ply];
      const san = (u: string) => { try { return pos.move(parseUci(u)).san; } finally { pos.load(fenBefore); } };
      const promo = (to[1] === "8" || to[1] === "1") && pos.get(from as Square)?.type === "p" ? "q" : "";
      setWrong({ played: san(from + to + promo), correct: san(exp) });
    }
    // Plies jugados desde startFen: en el fallo nos quedamos donde te equivocaste
    const end = res === "solved" ? puzzle.moves.length - 1 : run.ply - 1;
    setEndCursor(end);
    ex.goTo(end);
    setStatus(res);
    onResult({
      correct: res === "solved",
      firstMoveCorrect: res === "solved" || run.ply > 1,
      timeMs,
      firstMoveMs: firstMoveMs.current,
      failedAtPly: res === "failed" ? run.ply : undefined,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run, status, waiting, onResult, ex.goTo]);

  const toMove = run.orientation === "white" ? "White" : "Black";
  const message = {
    intro: <span className="muted">Get ready…</span>,
    playing: <><span className={`dot ${run.orientation}`} /> {toMove} to move</>,
    solved: <span className="good">✓ Correct!</span>,
    failed: <span className="bad">✗ Missed</span>,
  }[status];

  return (
    <div className="solver">
      <div className="solver-top">
        <p className="solver-msg">{message}</p>
        {finished ? <MoveStrip ex={ex} /> : <span className="grow" />}
        <span className={`clock ${status === "playing" ? "running" : ""}`}>⏱ {fmtClock(elapsed)}</span>
      </div>

      {finished && analyse && <EvalBar ex={ex} />}
      {/* Un único tablero para todo el puzzle: al fallar las piezas solo vuelven atrás, no se reinicia */}
      <Board
        fen={finished ? ex.fen : view.fen}
        orientation={run.orientation}
        turnColor={finished ? (ex.pos.turn() === "w" ? "white" : "black") : run.game.turn() === "b" ? "black" : "white"}
        dests={finished ? ex.dests : view.dests}
        lastMove={finished ? ex.lastMove ?? uciPair(puzzle.moves[0]) : view.lastMove}
        onMove={finished ? ex.onMove : onMove}
        movableColor={finished ? "both" : undefined}
      />
      {finished && <ExplorerControls ex={ex} />}

      <div className="solver-bar">
        {wrong && <p className="small">You played <strong className="bad">{wrong.played}</strong> · the solution was <strong className="good">{wrong.correct}</strong></p>}
        {status === "failed" && failHint && <p className="small muted">{failHint}</p>}
        {finished && (
          <div className="row">
            {status === "failed" &&
              <button className="btn" onClick={() => ex.playFrom(endCursor)} disabled={ex.playing}>Show solution</button>}
            <button className={`btn ${analyse ? "on" : ""}`} onClick={() => setAnalyse(!analyse)}>
              {analyse ? "Stop engine" : "Analyse"}
            </button>
            {onNext && <button className="btn primary" onClick={onNext} autoFocus>Next →</button>}
          </div>
        )}
      </div>
      {finished && <EngineLines ex={ex} />}
      {finished && <LichessLink fen={ex.fen} orientation={run.orientation} />}
    </div>
  );
}
