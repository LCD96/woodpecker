// Piezas de interfaz del repaso tras un puzzle; el estado vive en useExplorer.

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

export function ExplorerControls({ ex, orientation }: { ex: ExplorerState; orientation: "white" | "black" }) {
  const best = ex.lines[0];
  return (
    <div className="explorer">
      <div className="nav">
        <button className="btn" onClick={() => ex.goTo(0)} aria-label="First">⏮</button>
        <button className="btn" onClick={() => ex.goTo(ex.cursor - 1)} aria-label="Previous">◀</button>
        <button className="btn" onClick={() => ex.goTo(ex.cursor + 1)} aria-label="Next move">▶</button>
        <button className="btn" onClick={() => ex.goTo(ex.moves.length)} aria-label="Last">⏭</button>
      </div>

      <div className="movelist">
        {ex.sans.map((s, i) => (
          <button key={i} onClick={() => ex.goTo(i + 1)}
                  className={`mv ${ex.cursor === i + 1 ? "on" : ""} ${ex.deviates >= 0 && i >= ex.deviates ? "var" : ""}`}>
            <span className="mv-no">{ex.moveLabel(i)}</span>{s}
          </button>
        ))}
        {ex.deviates >= 0 && <button className="btn ghost small" onClick={ex.backToSolution}>↺ back to solution</button>}
      </div>

      {ex.engineOn && (
        <div className="engine">
          <div className="small muted">Stockfish 18 · depth {best?.depth ?? 0}/{engine.depth}</div>
          {ex.lines.map((l) => (
            <button key={l.multipv} className="pv" onClick={() => ex.play(l.pv[0])}>
              <strong>{fmtEval(l)}</strong> <span>{ex.pvSan(l)}</span>
            </button>
          ))}
          {!ex.lines.length && !ex.pos.isGameOver() && <div className="small muted">Thinking…</div>}
        </div>
      )}
      <a className="small" target="_blank" rel="noreferrer"
         href={`https://lichess.org/analysis/standard/${ex.fen.replace(/ /g, "_")}?color=${orientation}`}>Open this position on Lichess ↗</a>
    </div>
  );
}
