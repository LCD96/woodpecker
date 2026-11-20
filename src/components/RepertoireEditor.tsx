// Editor de repertorio: se navega jugando en el tablero (o pulsando jugadas del explorador/motor) y se añade
// al repertorio lo que se quiera. Las jugadas que aún no están en el repertorio se ven en cursiva.

import { useCallback, useEffect, useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { Board, type DrawShape } from "./Board";
import { db, type CachedEval } from "../lib/db";
import { START_FEN, boardUci, dests, lineSan, play, posKey, turnOf, uciPair } from "../lib/openings/chess";
import { explore, explorerLabel, scoreFor, total, type ExplorerResult } from "../lib/openings/explorer";
import { fmtLine, getEval } from "../lib/openings/evals";
import { exportPgn, parsePgn } from "../lib/openings/pgn";
import { addMoves, buildGraph, deleteMove, isMine, setComment, type NewMove } from "../lib/openings/repertoire";
import { useSettings } from "../lib/settings";

interface Step { fen: string; uci: string; san: string; }

const pct = (x: number) => `${Math.round(x * 100)}%`;

export function RepertoireEditor({ repId, onExit }: { repId: string; onExit: () => void }) {
  const graph = useLiveQuery(async () => {
    const rep = await db.repertoires.get(repId);
    return rep && buildGraph(rep, await db.repMoves.where("repId").equals(repId).toArray());
  }, [repId]);
  const settings = useSettings();
  const [path, setPath] = useState<Step[]>([]);
  const [redo, setRedo] = useState<Step[]>([]);
  const [orientation, setOrientation] = useState<"white" | "black">();
  const [explorer, setExplorer] = useState<{ fen: string; data?: ExplorerResult; error?: string }>();
  const [evaluation, setEvaluation] = useState<{ fen: string; data?: CachedEval }>();
  const [label, setLabel] = useState("");
  const [msg, setMsg] = useState<string>();
  const [showImport, setShowImport] = useState(false);
  const [allMoves, setAllMoves] = useState(false);

  const fen = path.at(-1)?.fen ?? START_FEN;
  const key = posKey(fen);
  const fenBefore = (i: number) => (i === 0 ? START_FEN : path[i - 1].fen);

  // ---------- Datos de la posición ----------

  const explorerKey = `${settings.explorerSource}|${settings.explorerRatings}|${settings.explorerSpeeds}|${!!settings.lichessToken}`;
  useEffect(() => {
    let cancelled = false;
    explorerLabel().then((l) => !cancelled && setLabel(l));
    const t = setTimeout(() => {         // al pasar rápido por las jugadas no se lanza una petición por cada una
      explore(fen).then((data) => !cancelled && setExplorer({ fen, data }),
                        (e: Error) => !cancelled && setExplorer({ fen, error: e.message }));
    }, 250);
    return () => { cancelled = true; clearTimeout(t); };
  }, [fen, explorerKey]);

  useEffect(() => {
    let cancelled = false;
    const t = setTimeout(() => {
      getEval(fen, 3).then((data) => !cancelled && setEvaluation({ fen, data }),
                           () => !cancelled && setEvaluation({ fen }));
    }, 300);
    return () => { cancelled = true; clearTimeout(t); };
  }, [fen]);

  // ---------- Navegación ----------

  const go = useCallback((uci: string) => {
    const r = play(fen, uci);
    if (!r) return;
    setPath((p) => [...p, { fen: r.fen, uci: r.uci, san: r.san }]);
    setRedo((rd) => (rd.at(-1)?.uci === r.uci ? rd.slice(0, -1) : []));
  }, [fen]);
  const back = () => { if (path.length) { setRedo((r) => [...r, path.at(-1)!]); setPath(path.slice(0, -1)); } };
  const forward = () => {
    const next = redo.at(-1)?.uci ?? graph?.byFrom.get(key)?.[0]?.uci;
    if (next) go(next);
  };
  const goTo = (i: number) => { setRedo([...path.slice(i).reverse(), ...redo]); setPath(path.slice(0, i)); };
  const onMove = useCallback((from: string, to: string) => go(boardUci(fen, from, to)), [fen, go]);

  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest("textarea, input")) return;
      if (e.key === "ArrowLeft") back();
      if (e.key === "ArrowRight") forward();
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  });

  const boardDests = useMemo(() => dests(fen), [fen]);

  if (!graph) return <p className="muted center">Loading…</p>;
  const rep = graph.rep;
  const children = graph.byFrom.get(key) ?? [];
  const has = (from: string, uci: string) => (graph.byFrom.get(posKey(from)) ?? []).some((m) => m.uci === uci);
  const missing = path.filter((s, i) => !has(fenBefore(i), s.uci)).length;
  const lastInRep = path.length > 0 && has(fenBefore(path.length - 1), path.at(-1)!.uci)
    ? graph.byFrom.get(posKey(fenBefore(path.length - 1)))!.find((m) => m.uci === path.at(-1)!.uci) : undefined;
  const mine = isMine(rep, key);
  const side = turnOf(fen);

  // ---------- Cambios ----------

  const pathMoves = (): NewMove[] => path.map((s, i) => ({ from: fenBefore(i), uci: s.uci }));
  const add = async (extra: NewMove[] = []) => {
    const n = await addMoves(rep, [...pathMoves(), ...extra]);
    setMsg(n ? `Added ${n} move${n > 1 ? "s" : ""}` : "Already in your repertoire");
  };
  const addReplies = (minShare: number) => {
    const d = explorer?.fen === fen ? explorer.data : undefined;
    if (!d) return;
    const n = total(d);
    add(d.moves.filter((m) => n && total(m) / n >= minShare).map((m) => ({ from: fen, uci: m.uci })));
  };
  const remove = async (id: string, san: string) => {
    if (!confirm(`Delete ${san} and every line after it?`)) return;
    await deleteMove(rep, id);
  };
  const download = () => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([exportPgn(graph)], { type: "application/x-chess-pgn" }));
    a.download = `${rep.name.replace(/[^\w-]+/g, "_")}.pgn`;
    a.click();
  };

  const shapes: DrawShape[] = children.map((m) => ({
    orig: m.uci.slice(0, 2), dest: m.uci.slice(2, 4), brush: isMine(rep, m.from) ? "green" : "blue",
  }) as DrawShape);

  const ex = explorer?.fen === fen ? explorer : undefined;
  const ev = evaluation?.fen === fen ? evaluation : undefined;
  const exTotal = ex?.data ? total(ex.data) : 0;

  return (
    <div className="editor">
      <div className="solver-top">
        <button className="btn ghost small" onClick={onExit}>← Repertoires</button>
        <span className="small"><strong>{rep.name}</strong> <span className="muted">· {rep.color} · {graph.moves.length} moves</span></span>
      </div>

      <div className="movelist line">
        <button className={`mv ${path.length === 0 ? "on" : ""}`} onClick={() => goTo(0)}>Start</button>
        {path.map((s, i) => (
          <button key={i} onClick={() => goTo(i + 1)}
                  className={`mv ${path.length === i + 1 ? "on" : ""} ${has(fenBefore(i), s.uci) ? "" : "var"}`}>
            <span className="mv-no">{i % 2 === 0 ? `${i / 2 + 1}.` : ""}</span>{s.san}
          </button>
        ))}
      </div>
      {ex?.data?.opening && <p className="small muted opening-name">{ex.data.opening.eco} · {ex.data.opening.name}</p>}

      <Board fen={fen} orientation={orientation ?? rep.color} turnColor={side} dests={boardDests}
             lastMove={path.length ? uciPair(path.at(-1)!.uci) : undefined} onMove={onMove} movableColor="both" shapes={shapes} />

      <div className="nav">
        <button className="btn" onClick={() => goTo(0)} aria-label="Start">⏮</button>
        <button className="btn" onClick={back} aria-label="Back">◀</button>
        <button className="btn" onClick={forward} aria-label="Forward">▶</button>
        <button className="btn" onClick={() => setOrientation((orientation ?? rep.color) === "white" ? "black" : "white")} aria-label="Flip board">⇅</button>
      </div>

      {missing > 0 && (
        <div className="callout info row between">
          <span>{missing} move{missing > 1 ? "s" : ""} on this line {missing > 1 ? "aren't" : "isn't"} in your repertoire</span>
          <button className="btn primary" onClick={() => add()}>Add line</button>
        </div>
      )}
      {msg && <p className="small muted" onClick={() => setMsg(undefined)}>{msg}</p>}

      <section className="panel">
        <h3>{mine ? "Your move here" : "Opponent replies you prepared"}</h3>
        {!children.length && <p className="small muted">{mine ? "Nothing yet: pick a move from the engine or the explorer, or play it on the board." : "None yet."}</p>}
        {children.map((m) => (
          <div key={m.id} className="rep-move">
            <button className="mv" onClick={() => go(m.uci)}><strong>{m.san}</strong></button>
            <span className="small muted grow">{m.comment ?? ""}</span>
            <button className="btn ghost small" onClick={() => remove(m.id, m.san)} aria-label={`Delete ${m.san}`}>🗑</button>
          </div>
        ))}
        {mine && children.length > 1 && <p className="small muted">You have {children.length} moves here; in training any of them counts as correct.</p>}
      </section>

      {lastInRep && (
        <section className="panel">
          <h3>Notes on {lastInRep.san}</h3>
          <textarea key={lastInRep.id} defaultValue={lastInRep.comment ?? ""} rows={3}
                    placeholder="Why this move? Plans, traps, what to remember…"
                    onBlur={(e) => { if ((e.target.value.trim() || undefined) !== lastInRep.comment) setComment(lastInRep.id, e.target.value); }} />
        </section>
      )}

      <section className="panel">
        <h3>Engine <span className="small muted">{ev?.data ? `${ev.data.source === "cloud" ? "Lichess cloud" : "Stockfish"} · depth ${ev.data.depth}` : ""}</span></h3>
        {!ev && <p className="small muted">Analysing…</p>}
        {ev && !ev.data && <p className="small muted">No evaluation for this position.</p>}
        {ev?.data?.lines.map((l) => (
          <div key={l.uci} className="rep-move">
            <button className="pv grow" onClick={() => go(l.uci)}>
              <strong>{fmtLine(l)}</strong> <span>{lineSan(fen, l.pv, 8).join(" ")}</span>
            </button>
            {has(fen, l.uci) ? <span className="good small">✓</span>
              : <button className="btn small" onClick={() => add([{ from: fen, uci: l.uci }])} aria-label="Add">+</button>}
          </div>
        ))}
      </section>

      <section className="panel">
        <h3>Explorer <span className="small muted">{label}</span></h3>
        {!ex && <p className="small muted">Loading…</p>}
        {ex?.error && <p className="small bad">{ex.error}</p>}
        {ex?.data && !ex.data.moves.length && <p className="small muted">No games from this position.</p>}
        {ex?.data && ex.data.moves.length > 0 && (
          <table className="explorer-table">
            <thead><tr><th>Move</th><th>Played</th><th>Games</th><th>Result for {side}</th><th /></tr></thead>
            <tbody>
              {ex.data.moves.filter((m, i) => allMoves || i < 8 || total(m) / (exTotal || 1) >= 0.01).map((m) => {
                const n = total(m);
                return (
                  <tr key={m.uci}>
                    <td><button className="mv" onClick={() => go(m.uci)}><strong>{m.san}</strong></button></td>
                    <td>{pct(exTotal ? n / exTotal : 0)}</td>
                    <td className="muted">{n >= 1000 ? `${Math.round(n / 1000)}k` : n}</td>
                    <td>
                      <div className="wdl" title={`White ${m.white} · Draws ${m.draws} · Black ${m.black}`}>
                        <i className="w" style={{ width: pct(m.white / (n || 1)) }} />
                        <i className="d" style={{ width: pct(m.draws / (n || 1)) }} />
                        <i className="b" style={{ width: pct(m.black / (n || 1)) }} />
                      </div>
                      <span className="small muted">{pct(scoreFor(m, side))}</span>
                    </td>
                    <td>{has(fen, m.uci) ? <span className="good small">✓</span>
                      : <button className="btn small" onClick={() => add([{ from: fen, uci: m.uci }])} aria-label="Add">+</button>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        {ex?.data && ex.data.moves.length > 8 && (
          <button className="btn ghost small" onClick={() => setAllMoves(!allMoves)}>{allMoves ? "Show fewer" : `Show all ${ex.data.moves.length} moves`}</button>
        )}
        {!mine && ex?.data && ex.data.moves.length > 0 && (
          <div className="row">
            <span className="small muted">Add every reply played at least</span>
            {[0.05, 0.1, 0.2].map((x) => <button key={x} className="btn small" onClick={() => addReplies(x)}>{pct(x)}</button>)}
          </div>
        )}
      </section>

      <section className="panel">
        <div className="row">
          <button className="btn" onClick={() => setShowImport(!showImport)}>Import PGN</button>
          <button className="btn" onClick={download} disabled={!graph.moves.length}>Export PGN</button>
        </div>
        {showImport && <PgnImport onImport={async (text, onlyMain) => {
          const r = parsePgn(text);
          const n = await addMoves(rep, r.moves, onlyMain);
          setShowImport(false);
          setMsg([`Imported ${n} new moves from ${r.games} game${r.games === 1 ? "" : "s"}.`,
            r.skipped ? `${r.skipped} skipped (they don't start from the initial position).` : "",
            r.errors.length ? `Problems: ${r.errors.join(", ")}.` : ""].filter(Boolean).join(" "));
        }} />}
      </section>
    </div>
  );
}

function PgnImport({ onImport }: { onImport: (text: string, onlyMain: boolean) => Promise<void> }) {
  const [text, setText] = useState("");
  const [onlyMain, setOnlyMain] = useState(true);
  const [busy, setBusy] = useState(false);
  return (
    <div className="pgn-import">
      <p className="small muted">Paste PGN (a Lichess study export works, with all its chapters, variations and comments) or choose a file.</p>
      <textarea rows={6} value={text} onChange={(e) => setText(e.target.value)} placeholder="1. e4 e5 2. Nf3 {Develop} Nc6 (2... d6) 3. Bb5 *" />
      <div className="row">
        <label className="btn">
          Choose file…
          <input type="file" accept=".pgn,text/plain" hidden onChange={async (e) => { const f = e.target.files?.[0]; if (f) setText(await f.text()); e.target.value = ""; }} />
        </label>
        <label className="small"><input type="checkbox" checked={onlyMain} onChange={(e) => setOnlyMain(e.target.checked)} /> Only one move of mine per position (the main line)</label>
      </div>
      <button className="btn primary" disabled={!text.trim() || busy}
              onClick={async () => { setBusy(true); try { await onImport(text, onlyMain); } finally { setBusy(false); } }}>
        {busy ? "Importing…" : "Import"}
      </button>
    </div>
  );
}
