// Editor de repertorio: se navega jugando en el tablero (o pulsando jugadas de la tabla) y se añade
// al repertorio lo que se quiera. Las jugadas que aún no están en el repertorio se ven en cursiva.
// En pantallas anchas, tablero a la izquierda y paneles a la derecha.

import { useEffect, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { Board, type DrawShape } from "./Board";
import { MoveTable } from "./MoveTable";
import { db } from "../lib/db";
import { START_FEN, boardUci, dests, lineSan, play, posKey, turnOf, uciPair } from "../lib/openings/chess";
import { levelLabel } from "../lib/openings/explorer";
import { fmtLine } from "../lib/openings/evals";
import { exportPgn, parsePgn } from "../lib/openings/pgn";
import { getPlan, type Plan } from "../lib/openings/plans";
import { addMoves, buildGraph, deleteMove, isMine, setComment, type NewMove } from "../lib/openings/repertoire";
import { usePositionReport } from "../lib/openings/report";
import { useSettings } from "../lib/settings";

interface Step { fen: string; uci: string; san: string; }

/** Los planes se pueden pedir desde la jugada 4 y salen solos desde la 8 o al final de una línea del repertorio */
const PLANS_FROM_PLY = 6, PLANS_AUTO_PLY = 14, PLANS_LEAF_PLY = 8;

export function RepertoireEditor({ repId, onExit }: { repId: string; onExit: () => void }) {
  const graph = useLiveQuery(async () => {
    const rep = await db.repertoires.get(repId);
    return rep && buildGraph(rep, await db.repMoves.where("repId").equals(repId).toArray());
  }, [repId]);
  const settings = useSettings();
  const [path, setPath] = useState<Step[]>([]);
  const [redo, setRedo] = useState<Step[]>([]);
  const [orientation, setOrientation] = useState<"white" | "black">();
  const [label, setLabel] = useState("");
  const [msg, setMsg] = useState<string>();
  const [showImport, setShowImport] = useState(false);
  const [preview, setPreview] = useState<string>();
  const [plansMode, setPlansMode] = useState<"auto" | "on" | "off">("auto");
  const [planSide, setPlanSide] = useState<"white" | "black">();
  const [plan, setPlan] = useState<{ key: string; plan?: Plan; error?: string }>();
  const [planHover, setPlanHover] = useState<number>();

  const fen = path.at(-1)?.fen ?? START_FEN;
  const key = posKey(fen);
  const fenBefore = (i: number) => (i === 0 ? START_FEN : path[i - 1].fen);
  const steps = path.map((s, i) => ({ before: fenBefore(i), uci: s.uci }));
  const report = usePositionReport(fen, steps, graph);

  useEffect(() => { levelLabel().then(setLabel); }, [settings.lichessToken, settings.explorerRatings, settings.explorerSpeeds]);

  // ---------- Planes ----------

  const children = graph?.byFrom.get(key) ?? [];
  const inRep = path.length > 0 && !!graph?.byFrom.get(posKey(fenBefore(path.length - 1)))?.some((m) => m.uci === path.at(-1)!.uci);
  const leaf = inRep && !children.length;
  const plansAllowed = path.length >= PLANS_FROM_PLY;
  const plansShown = plansAllowed && (plansMode === "on" || (plansMode === "auto" && (path.length >= PLANS_AUTO_PLY || (leaf && path.length >= PLANS_LEAF_PLY))));
  const side = planSide ?? graph?.rep.color ?? "white";
  const planKey = `${key}|${side}`;

  useEffect(() => {
    if (!plansShown) return;
    let cancelled = false;
    const t = setTimeout(() => {           // al pasar rápido por las jugadas no se piden partidas de cada posición
      getPlan(fen, side).then((p) => !cancelled && setPlan({ key: planKey, plan: p }),
                              (e: Error) => !cancelled && setPlan({ key: planKey, error: e.message }));
    }, 600);
    return () => { cancelled = true; clearTimeout(t); };
  }, [plansShown, fen, side, planKey]);

  // ---------- Navegación ----------

  const go = (uci: string) => {
    const r = play(fen, uci);
    if (!r) return;
    setPreview(undefined);
    setPath((p) => [...p, { fen: r.fen, uci: r.uci, san: r.san }]);
    setRedo((rd) => (rd.at(-1)?.uci === r.uci ? rd.slice(0, -1) : []));
  };
  const back = () => { if (path.length) { setRedo((r) => [...r, path.at(-1)!]); setPath(path.slice(0, -1)); } };
  const forward = () => {
    const next = redo.at(-1)?.uci ?? children[0]?.uci;
    if (next) go(next);
  };
  const goTo = (i: number) => { setRedo([...path.slice(i).reverse(), ...redo]); setPath(path.slice(0, i)); };
  const onMove = (from: string, to: string) => go(boardUci(fen, from, to));

  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest("textarea, input")) return;
      if (e.key === "ArrowLeft") back();
      if (e.key === "ArrowRight") forward();
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  });

  // Al pasar el ratón por una jugada de la tabla, el tablero la muestra
  const shownPos = preview ? play(fen, preview) : undefined;
  const boardDests = shownPos ? new Map<string, string[]>() : dests(fen);

  if (!graph) return <p className="muted center">Loading…</p>;
  const rep = graph.rep;
  const has = (from: string, uci: string) => (graph.byFrom.get(posKey(from)) ?? []).some((m) => m.uci === uci);
  const missing = path.filter((s, i) => !has(fenBefore(i), s.uci)).length;
  const lastInRep = inRep ? graph.byFrom.get(posKey(fenBefore(path.length - 1)))!.find((m) => m.uci === path.at(-1)!.uci) : undefined;
  const mine = isMine(rep, key);

  // ---------- Cambios ----------

  const pathMoves = (): NewMove[] => path.map((s, i) => ({ from: fenBefore(i), uci: s.uci }));
  const add = async (extra: NewMove[] = []) => {
    const n = await addMoves(rep, [...pathMoves(), ...extra]);
    setMsg(n ? `Added ${n} move${n > 1 ? "s" : ""}` : "Already in your repertoire");
  };
  const addReplies = (minShare: number) =>
    add((report?.rows ?? []).filter((r) => (r.levelShare ?? r.mastersShare ?? 0) >= minShare).map((r) => ({ from: fen, uci: r.uci })));
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

  const currentPlan = plansShown && plan?.key === planKey ? plan : undefined;
  const shapes: DrawShape[] = shownPos ? []
    : currentPlan?.plan?.items.length
      ? currentPlan.plan.items.flatMap((it, i) => (planHover === undefined || planHover === i ? it.arrows : []))
          .map((a) => ({ orig: a.orig, dest: a.dest, brush: "yellow" }) as DrawShape)
      : children.map((m) => ({ orig: m.uci.slice(0, 2), dest: m.uci.slice(2, 4), brush: isMine(rep, m.from) ? "green" : "blue" }) as DrawShape);
  const ev = report?.eval;
  const Side = side === "white" ? "White" : "Black";

  return (
    <div className="editor">
      <div className="editor-main">
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
        {(report?.level ?? report?.masters)?.opening && (
          <p className="small muted opening-name">{(report!.level ?? report!.masters)!.opening!.eco} · {(report!.level ?? report!.masters)!.opening!.name}</p>
        )}

        <Board fen={shownPos?.fen ?? fen} orientation={orientation ?? rep.color} turnColor={turnOf(shownPos?.fen ?? fen)} dests={boardDests}
               lastMove={preview ? uciPair(preview) : path.length ? uciPair(path.at(-1)!.uci) : undefined}
               onMove={onMove} movableColor="both" shapes={shapes} />

        <div className="nav">
          <button className="btn" onClick={() => goTo(0)} aria-label="Start">⏮</button>
          <button className="btn" onClick={back} aria-label="Back">◀</button>
          <button className="btn" onClick={forward} aria-label="Forward">▶</button>
          <button className="btn" onClick={() => setOrientation((orientation ?? rep.color) === "white" ? "black" : "white")} aria-label="Flip board">⇅</button>
          <button className={`btn ${plansShown ? "on" : ""}`} disabled={!plansAllowed} title={plansAllowed ? "Typical plans from this position" : "Available from move 4"}
                  onClick={() => setPlansMode(plansShown ? "off" : "on")}>Plans</button>
        </div>

        {missing > 0 && (
          <div className="callout info row between">
            <span>{missing} move{missing > 1 ? "s" : ""} on this line {missing > 1 ? "aren't" : "isn't"} in your repertoire</span>
            <button className="btn primary" onClick={() => add()}>Add line</button>
          </div>
        )}
        {msg && <p className="small muted" onClick={() => setMsg(undefined)}>{msg}</p>}
      </div>

      <div className="editor-side">
        {plansShown && (
          <section className="panel plans">
            <h3>
              Plans for
              <span className="seg">
                {(["white", "black"] as const).map((c) => (
                  <button key={c} className={side === c ? "on" : ""} onClick={() => setPlanSide(c)}>{c === "white" ? "White" : "Black"}</button>
                ))}
              </span>
              <button className="btn ghost small" onClick={() => setPlansMode("off")} aria-label="Close plans">✕</button>
            </h3>
            {!currentPlan && <p className="small muted">Looking at games from this position…</p>}
            {currentPlan?.error && <p className="small bad">{currentPlan.error}</p>}
            {currentPlan?.plan && !currentPlan.plan.items.length && (
              <p className="small muted">{currentPlan.plan.games < 3 ? "Not enough games reached this position to find typical plans." : `No clear plan for ${Side} in ${currentPlan.plan.games} games.`}</p>
            )}
            {currentPlan?.plan && currentPlan.plan.items.length > 0 && <>
              <ul className="plan-list">
                {currentPlan.plan.items.map((it, i) => (
                  <li key={i} onMouseEnter={() => setPlanHover(i)} onMouseLeave={() => setPlanHover(undefined)}>
                    {it.parts.map((p, j) => (j % 2 ? <span key={j} className="plan-hl">{p}</span> : p))}
                  </li>
                ))}
              </ul>
              <p className="tiny muted">From the next 12 moves of {currentPlan.plan.games} games that reached this position. Hover an idea to see only its arrows.</p>
            </>}
          </section>
        )}

        <section className="panel">
          <h3>{mine ? "Your move here" : "Opponent replies you prepared"}</h3>
          {!children.length && <p className="small muted">{mine ? "Nothing yet: pick a move from the table below, or play it on the board." : "None yet."}</p>}
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

        <MoveTable report={report} levelLabel={label} color={rep.color} mine={mine}
                   onGo={go} onAdd={(uci) => add([{ from: fen, uci }])} onHover={setPreview} />
        {!mine && (report?.rows.length ?? 0) > 0 && (
          <div className="row add-replies">
            <span className="small muted">Add every reply played at least</span>
            {[0.05, 0.1, 0.2].map((x) => <button key={x} className="btn small" onClick={() => addReplies(x)}>{Math.round(x * 100)}%</button>)}
          </div>
        )}

        <section className="panel">
          <h3>Engine lines <span className="small muted">{ev ? `${ev.source === "cloud" ? "Lichess cloud" : "Stockfish"} · depth ${ev.depth}` : report?.evalDone ? "" : "analysing…"}</span></h3>
          {report?.evalDone && !ev && <p className="small muted">No evaluation for this position.</p>}
          {ev?.lines.slice(0, 3).map((l) => (
            <button key={l.uci} className="pv" onClick={() => go(l.uci)} onMouseEnter={() => setPreview(l.uci)} onMouseLeave={() => setPreview(undefined)}>
              <strong>{fmtLine(l)}</strong> <span>{lineSan(fen, l.pv, 8).join(" ")}</span>
            </button>
          ))}
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
