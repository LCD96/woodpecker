// Tabla única de jugadas de una posición: popularidad a tu nivel y entre maestros, evaluación, resultados,
// errores típicos, transposiciones y cada cuántas partidas aparece la posición resultante.

import { useState } from "react";
import { fmtLine } from "../lib/openings/evals";
import { total, type ExplorerResult } from "../lib/openings/explorer";
import type { MoveRow, Report } from "../lib/openings/report";

const NAG = { "?!": "inaccuracy", "?": "mistake", "??": "blunder" } as const;
const pct = (x?: number) => (x === undefined ? "—" : x < 0.01 && x > 0 ? "<1%" : `${Math.round(x * 100)}%`);
const fmtGames = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e4 ? `${Math.round(n / 1000)}k` : n.toLocaleString("en-US"));

export function EvalChip({ e }: { e?: MoveRow["eval"] }) {
  if (!e) return <span className="eval-chip none">—</span>;
  const white = e.mate !== undefined ? e.mate > 0 : (e.cp ?? 0) >= -15;    // igualdad = blanco
  return <span className={`eval-chip ${white ? "w" : "b"}`}>{fmtLine(e)}</span>;
}

export function Results({ r, showTotal }: { r: { white: number; draws: number; black: number }; showTotal?: boolean }) {
  const n = total(r) || 1;
  const seg = (v: number, cls: string, label: string) => {
    const w = v / n;
    return <i className={cls} style={{ width: `${w * 100}%` }} title={`${label} ${pct(w)}`}>{w >= 0.14 ? pct(w) : ""}</i>;
  };
  return (
    <div className="results">
      <div className="wdl big">{seg(r.white, "w", "White wins")}{seg(r.draws, "d", "Draws")}{seg(r.black, "b", "Black wins")}</div>
      {showTotal && <span className="small muted">{fmtGames(total(r))} games</span>}
    </div>
  );
}

function Summary({ title, r }: { title: string; r?: ExplorerResult }) {
  if (!r || !total(r)) return null;
  return (
    <div className="summary-row">
      <span className="small">{title}</span>
      <Results r={r} />
      <span className="small muted">{fmtGames(total(r))} games</span>
    </div>
  );
}

interface Props {
  report?: Report;
  levelLabel: string;
  color: "white" | "black";
  mine: boolean;
  onGo: (uci: string) => void;
  onAdd: (uci: string) => void;
  onHover: (uci?: string) => void;
}

export function MoveTable({ report, levelLabel, color, mine, onGo, onAdd, onHover }: Props) {
  const [all, setAll] = useState(false);
  if (!report) return <section className="panel"><h3>Moves</h3><p className="small muted">Loading…</p></section>;
  const Color = color === "white" ? "White" : "Black";
  const rows = report.rows;
  const shown = all ? rows : rows.filter((r, i) => i < 8 || (r.levelShare ?? 0) >= 0.01 || r.inRep || (r.engineRank ?? 9) < 3);
  const level = report.source === "lichess" ? report.level : report.masters;

  return (
    <section className="panel move-table">
      <h3>{mine ? "Choose your move" : "Choose a move to prepare for"}</h3>
      <Summary title={report.source === "lichess" ? "At your level" : "Masters"} r={level} />
      {report.source === "lichess" && <Summary title="Masters" r={report.masters} />}
      <p className="small muted">{levelLabel}</p>
      {report.levelError && <p className="small bad">{report.levelError}</p>}
      {report.reach !== undefined && report.reach > 0 && report.reach < 1 && (
        <p className="small" title={`Based on how often your opponents play each move of this line at your level`}>
          You reach this position in about <strong>1 of {Math.round(1 / report.reach).toLocaleString("en-US")}</strong> games as {Color}.
        </p>
      )}

      {!rows.length && <p className="small muted">{report.evalDone ? "No games or engine lines for this position." : "Loading…"}</p>}
      {rows.length > 0 && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Move</th><th>Eval</th>
                <th title="Share of games at your level">{report.source === "lichess" ? "Level" : "Played"}</th>
                {report.source === "lichess" && <th title="Share of master games">GMs</th>}
                <th>Results</th>
                {!mine && <th title="How often you'll face the position after this move">Seen every</th>}
                <th />
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => (
                <tr key={r.uci} className={r.inRep ? "in-rep" : ""} onMouseEnter={() => onHover(r.uci)} onMouseLeave={() => onHover(undefined)}>
                  <td>
                    <button className="mv" onClick={() => onGo(r.uci)}>
                      <strong>{r.san}</strong>{r.label && <span className={`nag ${NAG[r.label]}`}>{r.label}</span>}
                    </button>
                    {(r.commonMistake || r.transposes || (mine && r.engineRank === 0)) && (
                      <div className="badges">
                        {r.commonMistake && <span className="badge bad">Common mistake</span>}
                        {r.transposes && <span className="badge good">Transposes to your repertoire</span>}
                        {mine && r.engineRank === 0 && <span className="badge">Engine's choice</span>}
                      </div>
                    )}
                  </td>
                  <td>{r.eval ? <EvalChip e={r.eval} /> : <span className="eval-chip none">{report.evalDone && (r.levelShare ?? r.mastersShare ?? 0) >= 0.01 ? "…" : "—"}</span>}</td>
                  <td>{pct(r.levelShare ?? r.mastersShare)}</td>
                  {report.source === "lichess" && <td className="muted">{pct(r.mastersShare)}</td>}
                  <td className="res-cell">{total(r) ? <div className="res-flex"><Results r={r} /><span className="tiny muted">{fmtGames(total(r))}</span></div> : <span className="muted small">—</span>}</td>
                  {!mine && (
                    <td className="seen" title={r.seenEvery ? `You'll see the position after ${r.san} in 1 of ${Math.round(r.seenEvery).toLocaleString("en-US")} games as ${Color}` : undefined}>
                      {r.seenEvery ? <><strong>{Math.round(r.seenEvery).toLocaleString("en-US")}</strong> <span className="muted games-word">games</span></> : "—"}
                    </td>
                  )}
                  <td>{r.inRep ? <span className="good" title="In your repertoire">✓</span>
                    : <button className="btn small" onClick={() => onAdd(r.uci)} aria-label={`Add ${r.san}`}>+</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {rows.length > shown.length || all ? (
        <button className="btn ghost small" onClick={() => setAll(!all)}>{all ? "Show fewer" : `Show all ${rows.length} moves`}</button>
      ) : null}
    </section>
  );
}
