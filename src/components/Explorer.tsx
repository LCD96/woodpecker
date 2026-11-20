// Piezas de interfaz del repaso tras un puzzle; el estado vive en useExplorer.

import { useEffect, useRef, type ReactNode } from "react";
import { engine, evalToBar, fmtEval } from "../lib/engine";
import type { ExplorerState } from "../lib/useExplorer";

export function EvalBar({ ex }: { ex: ExplorerState }) {
  const best = ex.lines[0];
  return (
    <div className="evalbar" title="Stockfish evaluation">
      <div className="evalbar-white" style={{ width: `${evalToBar(best) * 100}%` }} />
      <span>{ex.pos.isCheckmate() ? "Checkmate" : ex.pos.isDraw() ? "Draw" : fmtEval(best)}</span>
    </div>
  );
}

/** Jugadas en una sola fila con scroll horizontal; la actual siempre a la vista */
export function MoveStrip({ ex }: { ex: ExplorerState }) {
  return (
    <ScrollStrip cursor={ex.cursor}>
      {ex.sans.map((s, i) => (
        <button key={i} onClick={() => ex.goTo(i + 1)}
                className={`mv ${ex.cursor === i + 1 ? "on" : ""} ${ex.deviates >= 0 && i >= ex.deviates ? "var" : ""}`}>
          <span className="mv-no">{ex.moveLabel(i)}</span>{s}
        </button>
      ))}
      {ex.deviates >= 0 && <button className="btn ghost small" onClick={ex.backToSolution} title="Back to solution">↺</button>}
    </ScrollStrip>
  );
}

/** Fila de jugadas que no crece: desborda en horizontal y desplaza hasta el elemento `.on` */
export function ScrollStrip({ cursor, className, children }: { cursor: unknown; className?: string; children: ReactNode }) {
  const el = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const box = el.current, on = box?.querySelector<HTMLElement>(".on");
    if (!box) return;
    if (!on) { box.scrollLeft = cursor === 0 ? 0 : box.scrollWidth; return; }
    const left = on.offsetLeft - box.offsetLeft, right = left + on.offsetWidth;
    if (left < box.scrollLeft) box.scrollLeft = left - 8;
    else if (right > box.scrollLeft + box.clientWidth) box.scrollLeft = right - box.clientWidth + 8;
  }, [cursor]);
  return <div ref={el} className={`strip ${className ?? ""}`}>{children}</div>;
}

export function ExplorerControls({ ex }: { ex: ExplorerState }) {
  return (
    <div className="nav">
      <button className="btn" onClick={() => ex.goTo(0)} aria-label="First">⏮</button>
      <button className="btn" onClick={() => ex.goTo(ex.cursor - 1)} aria-label="Previous">◀</button>
      <button className="btn" onClick={() => ex.goTo(ex.cursor + 1)} aria-label="Next move">▶</button>
      <button className="btn" onClick={() => ex.goTo(ex.moves.length)} aria-label="Last">⏭</button>
    </div>
  );
}

export function EngineLines({ ex }: { ex: ExplorerState }) {
  const best = ex.lines[0];
  if (!ex.engineOn) return null;
  return (
    <div className="engine">
      <div className="small muted">Stockfish 18 · depth {best?.depth ?? 0}/{engine.depth}</div>
      {ex.lines.map((l) => (
        <button key={l.multipv} className="pv" onClick={() => ex.play(l.pv[0])}>
          <strong>{fmtEval(l)}</strong> <span>{ex.pvSan(l)}</span>
        </button>
      ))}
      {!ex.lines.length && !ex.pos.isGameOver() && <div className="small muted">Thinking…</div>}
    </div>
  );
}

export function LichessLink({ fen, orientation }: { fen: string; orientation: "white" | "black" }) {
  return (
    <a className="small lichess-link" target="_blank" rel="noreferrer"
       href={`https://lichess.org/analysis/standard/${fen.replace(/ /g, "_")}?color=${orientation}`}>Open this position on Lichess ↗</a>
  );
}
