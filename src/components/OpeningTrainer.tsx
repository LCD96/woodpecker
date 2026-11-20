// Entrenador de aperturas.
// Flujo de una sesión:
// 1. Cola = posiciones tuyas pendientes (FSRS) + nuevas hasta el cupo diario.
// 2. Desde la posición inicial se recorre el repertorio hacia la pendiente más cercana; las jugadas que no toca
//    preguntar (del rival o tuyas ya sabidas) se juegan solas.
// 3. En una posición de la cola te toca mover:
//    - jugada del repertorio → correcto (Hard si pediste pista o notas, Again si viste la flecha)
//    - otra jugada que no empeora la evaluación más de la tolerancia → "también vale, prueba otra vez" (sin castigo)
//    - jugada que empeora → incorrecto: se ve cómo te castiga el rival y luego hay que jugar la buena
// 4. Al acabar una línea se vuelve al inicio hasta vaciar la cola.
// 5. Jugada extra: de vez en cuando, en una posición del rival, este juega algo habitual que no tienes preparado.
//    Tu respuesta se juzga con el motor; no cuenta para el calendario de repaso. Luego se sigue por donde iba.

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Chess } from "chess.js";
import { Board, type DrawShape } from "./Board";
import { ScrollStrip } from "./Explorer";
import { db, newId, type OpeningCard, type RepMove } from "../lib/db";
import { START_FEN, boardUci, dests, lineSan, play, posKey, turnOf, uciPair } from "../lib/openings/chess";
import { fmtLine, getEval, winChance } from "../lib/openings/evals";
import { addMoves, isMine, loadGraph, pathTo, reachable, type Graph } from "../lib/openings/repertoire";
import { BONUS_CHANCE, pickBonus, type Bonus } from "../lib/openings/bonus";
import { grade, isNew, Rating, sessionCards, type Grade } from "../lib/openings/srs";
import { useSettings } from "../lib/settings";

const STEP = 450;            // pausa entre jugadas automáticas
const REFUTE_STEP = 800;

type Phase = "loading" | "auto" | "ask" | "checking" | "refuting" | "wrong" | "fix" | "done" | "bonus" | "bonusCheck" | "bonusDone";

/** Respuestas normales entre dos jugadas extra */
const BONUS_GAP = 3;

interface BonusState {
  /** Posición antes de la jugada del rival, para seguir después */
  from: string;
  b: Bonus;
  t0: number;
  result?: { played?: { uci: string; san: string }; ok?: boolean; best?: { uci: string; san: string; eval: string } };
}

interface Ask {
  card: OpeningCard;
  fen: string;
  t0: number;
  hint: 0 | 1 | 2;
  notes: boolean;
  wrong: boolean;
  fresh: boolean;
}

interface Note { san: string; text: string; mine: boolean; }

export function OpeningTrainer({ repId, onExit }: { repId: string; onExit: () => void }) {
  const settings = useSettings();
  const [graph, setGraph] = useState<Graph>();
  const [phase, setPhase] = useState<Phase>("loading");
  const [fen, setFen] = useState(START_FEN);
  const [lastMove, setLastMove] = useState<[string, string]>();
  const [line, setLine] = useState<string[]>([]);           // SAN de la línea actual
  const [ask, setAsk] = useState<Ask>();
  const [msg, setMsg] = useState<ReactNode>();
  const [notes, setNotes] = useState<Note[]>([]);
  const [score, setScore] = useState({ done: 0, correct: 0, total: 0 });
  const [unreachable, setUnreachable] = useState(0);
  const [altMove, setAltMove] = useState<{ fen: string; uci: string; san: string }>();
  const [bonus, setBonus] = useState<BonusState>();
  const [bonusAdded, setBonusAdded] = useState(false);

  const queue = useRef(new Set<string>());
  const cards = useRef(new Map<string, OpeningCard>());
  const g = useRef<Graph | undefined>(undefined);
  const timers = useRef<number[]>([]);
  const bonusRef = useRef({ on: true, seen: new Set<string>(), used: 0, since: 0, max: 1 });
  const later = (f: () => void, ms: number) => { timers.current.push(window.setTimeout(f, ms)); };
  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  const ownMoves = (gr: Graph, f: string) => (gr.byFrom.get(posKey(f)) ?? []).filter((m) => isMine(gr.rep, m.from));

  const pushNote = (m: RepMove) => {
    if (m.comment) setNotes((n) => [...n.slice(-1), { san: m.san, text: m.comment!, mine: isMine(g.current!.rep, m.from) }]);
  };

  // ---------- Recorrido ----------

  // Declaración normal (no useCallback) porque se llama a sí misma desde los temporizadores;
  // solo usa refs y setters, así que una versión antigua de la función sigue siendo válida.
  function step(f: string) {
    const gr = g.current!;
    const key = posKey(f);
    if (!queue.current.size) { setPhase("done"); return; }
    if (queue.current.has(key) && ownMoves(gr, f).length) {
      const card = cards.current.get(key)!;
      const fresh = isNew(card);
      setAsk({ card, fen: f, t0: performance.now(), hint: 0, notes: fresh, wrong: false, fresh });
      setMsg(fresh ? <span className="accent">New position: play the move shown</span> : undefined);
      setPhase("ask");
      return;
    }
    const path = pathTo(gr, key, (k) => queue.current.has(k));
    if (path?.length) {
      const m = path[0];
      setPhase("auto");
      later(async () => {
        const b = await maybeBonus(gr, f);
        if (b) { startBonus(f, b); return; }
        const r = play(f, m.uci)!;
        setFen(r.fen); setLastMove(uciPair(m.uci)); setLine((l) => [...l, m.san]);
        pushNote(m);
        later(() => step(r.fen), STEP);
      }, STEP);
      return;
    }
    if (key === posKey(START_FEN)) {        // nada alcanzable: lo que quede en la cola no se puede llegar a preguntar
      setUnreachable(queue.current.size);
      setPhase("done"); return;
    }
    // Fin de la línea: otra vez desde el principio
    setPhase("auto");
    later(() => {
      setFen(START_FEN); setLastMove(undefined); setLine([]); setNotes([]);
      later(() => step(START_FEN), STEP);
    }, 900);
  }

  // ---------- Jugada extra ----------

  async function maybeBonus(gr: Graph, f: string) {
    const st = bonusRef.current, key = posKey(f);
    if (!st.on || turnOf(f) === gr.rep.color || st.seen.has(key) || st.since < BONUS_GAP || st.used >= st.max) return;
    st.seen.add(key);                       // una sola tirada por posición: si no, saldría siempre en las primeras jugadas
    if (Math.random() > BONUS_CHANCE) return;
    return pickBonus(gr, f).catch(() => undefined);
  }

  function startBonus(from: string, b: Bonus) {
    const st = bonusRef.current;
    st.used++; st.since = 0;
    setFen(b.fen); setLastMove(uciPair(b.uci)); setLine((l) => [...l, b.san]);
    setBonus({ from, b, t0: performance.now() });
    setBonusAdded(false);
    setMsg(<span><span className="accent">Bonus move</span> · {b.san} isn't in your repertoire. What would you play?</span>);
    setPhase("bonus");
  }

  const answerBonus = async (bs: BonusState, played?: { uci: string; san: string; fen: string }) => {
    setPhase("bonusCheck");
    setMsg(<span className="muted">{played ? `Checking ${played.san}…` : "Asking the engine…"}</span>);
    const [verdict, e] = await Promise.all([
      played ? judge(bs.b.fen, played.fen, played.uci).catch(() => undefined) : undefined,
      getEval(bs.b.fen, 5).catch(() => undefined),
    ]);
    const top = e?.lines[0];
    const best = top && { uci: top.uci, san: play(bs.b.fen, top.uci)?.san ?? top.uci, eval: fmtLine(top) };
    const ok = played && verdict ? verdict.loss <= settings.openingTolerance : undefined;
    await db.reviews.add({
      id: newId(), kind: "opening", refId: `bonus:${posKey(bs.b.fen)}`, correct: !!ok,
      timeMs: performance.now() - bs.t0, date: new Date().toISOString(),
    });
    setFen(bs.b.fen); setLastMove(uciPair(bs.b.uci));
    setBonus({ ...bs, result: { played, ok, best } });
    const other = best && played && best.uci !== played.uci;
    setMsg(!played ? <span>The engine suggests <strong>{best?.san ?? "—"}</strong>{best && <> ({best.eval})</>}</span>
      : !verdict ? <span className="muted">{played.san}: couldn't check it{best && <> · the engine suggests <strong>{best.san}</strong></>}</span>
      : ok ? <span className="good">✓ {played.san} is a good answer ({verdict.playedEval}){other && <span className="muted"> · engine: {best.san} ({best.eval})</span>}</span>
      : <span><span className="bad">✗ {played.san}</span> {verdict.bestEval} → {verdict.playedEval}{best && <> · better: <strong className="good">{best.san}</strong></>}</span>);
    setPhase("bonusDone");
  };

  const bonusAnswer = bonus?.result?.ok ? bonus.result.played : bonus?.result?.best;
  const addBonus = async () => {
    const gr = g.current;
    if (!gr || !bonus || !bonusAnswer) return;
    await addMoves(gr.rep, [{ from: bonus.from, uci: bonus.b.uci }, { from: bonus.b.fen, uci: bonusAnswer.uci }]);
    const ng = await loadGraph(repId);
    if (ng) { g.current = ng; setGraph(ng); }
    setBonusAdded(true);
  };

  const endBonus = () => {
    const bs = bonus;
    if (!bs) return;
    setBonus(undefined); setMsg(undefined);
    setFen(bs.from); setLastMove(undefined); setLine((l) => l.slice(0, -1));
    setPhase("auto");
    later(() => step(bs.from), STEP);
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const gr = await loadGraph(repId);
      if (!gr || cancelled) return;
      const live = reachable(gr);
      const mineAt = new Set(gr.moves.filter((m) => isMine(gr.rep, m.from)).map((m) => m.from));
      const repCards = (await db.cards.where("repId").equals(repId).toArray())
        .filter((c) => live.has(c.pos) && mineAt.has(c.pos))
        .sort((a, b) => a.due.localeCompare(b.due));
      const { due, fresh } = sessionCards(repCards, await db.cards.toArray(), settings.newCardsPerDay);
      g.current = gr;
      cards.current = new Map(repCards.map((c) => [c.pos, c]));
      queue.current = new Set([...due, ...fresh].map((c) => c.pos));
      setGraph(gr);
      setScore({ done: 0, correct: 0, total: queue.current.size });
      bonusRef.current = { on: settings.openingBonus, seen: new Set(), used: 0, since: 0, max: Math.max(1, Math.round(queue.current.size / 6)) };
      step(START_FEN);
    })();
    return () => { cancelled = true; };
    // Solo al empezar: los ajustes que cambien a mitad no rehacen la sesión
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repId]);

  // ---------- Respuesta ----------

  const finish = async (a: Ask, rating: Grade | undefined) => {
    queue.current.delete(a.card.pos);
    bonusRef.current.since++;
    if (rating !== undefined) cards.current.set(a.card.pos, await grade(a.card, rating));
    await db.reviews.add({
      id: newId(), kind: "opening", refId: a.card.id, correct: !a.wrong,
      timeMs: performance.now() - a.t0, date: new Date().toISOString(),
    });
    setScore((s) => ({ ...s, done: s.done + 1, correct: s.correct + (a.wrong ? 0 : 1) }));
  };

  const playCorrect = (a: Ask, m: RepMove) => {
    const r = play(a.fen, m.uci)!;
    setFen(r.fen); setLastMove(uciPair(m.uci)); setLine((l) => [...l, m.san]);
    setAsk(undefined);
    pushNote(m);
    setPhase("auto");
    later(() => step(r.fen), STEP);
  };

  const onMove = useCallback(async (from: string, to: string) => {
    if (phase === "bonus" && bonus) {
      const r = play(bonus.b.fen, boardUci(bonus.b.fen, from, to));
      if (!r) return;
      setFen(r.fen); setLastMove([from, to]);
      await answerBonus(bonus, r);
      return;
    }
    const gr = g.current;
    if (!gr || !ask || (phase !== "ask" && phase !== "fix")) return;
    const own = ownMoves(gr, ask.fen);
    const uci = boardUci(ask.fen, from, to, own.find((m) => m.uci.startsWith(from + to))?.uci);
    const hit = own.find((m) => m.uci === uci);
    setAltMove(undefined);

    if (hit) {
      setMsg(<span className="good">✓ {hit.san}</span>);
      if (phase === "ask") {
        // Nueva: verla no cuenta como pista. Flecha = no la sabías; pista o notas = te costó.
        const rating = ask.fresh ? Rating.Good : ask.hint === 2 ? Rating.Again : ask.hint === 1 || ask.notes ? Rating.Hard : Rating.Good;
        await finish({ ...ask }, rating);
      }
      playCorrect(ask, hit);
      return;
    }

    // No es del repertorio: ¿es mala o solo distinta?
    const r = play(ask.fen, uci);
    if (!r) return;
    setFen(r.fen); setLastMove([from, to]);
    setPhase("checking");
    setMsg(<span className="muted">{r.san} isn't in your repertoire. Checking it…</span>);
    const verdict = await judge(ask.fen, r.fen, r.uci).catch(() => undefined);

    if (!verdict || verdict.loss <= settings.openingTolerance) {
      // Vale: sin castigo, a intentarlo otra vez
      setAltMove({ fen: ask.fen, uci: r.uci, san: r.san });
      setMsg(<>
        <strong>{r.san}</strong> {verdict ? <>is fine too ({verdict.playedEval}, best {verdict.bestEval})</> : "couldn't be checked"}, but it's not
        your repertoire move. Try again.
      </>);
      // Se ve un momento la jugada y vuelve la posición; el botón de añadirla sigue disponible
      later(() => { setFen(ask.fen); setLastMove(undefined); setPhase(phase); }, 1000);
      return;
    }

    // Mala: castigo del rival
    const first = !ask.wrong && phase === "ask";
    const a = { ...ask, wrong: true };
    setAsk(a);
    if (first) {
      await finish(a, Rating.Again);
      queue.current.add(a.card.pos);              // se vuelve a preguntar en la siguiente vuelta
      setScore((sc) => ({ ...sc, total: sc.total + 1 }));
    }
    setMsg(<span className="bad">✗ {r.san}: {verdict.bestEval} → {verdict.playedEval}</span>);
    setPhase("refuting");
    const seq = verdict.refutation.slice(0, 3);
    let f = r.fen;
    seq.forEach((u, i) => later(() => {
      const s = play(f, u);
      if (!s) return;
      f = s.fen;
      setFen(s.fen); setLastMove(uciPair(u));
    }, REFUTE_STEP * (i + 1)));
    later(() => {
      setMsg(<>
        <span className="bad">✗ {r.san}</span> {verdict.bestEval} → {verdict.playedEval}.
        {seq.length > 0 && <> The punishment: <strong>{lineSan(r.fen, seq).join(" ")}</strong></>}
      </>);
      setPhase("wrong");
    }, REFUTE_STEP * (seq.length + 1));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ask, bonus, phase, settings.openingTolerance]);

  const retry = () => {
    if (!ask) return;
    setFen(ask.fen); setLastMove(undefined);
    setAsk({ ...ask, hint: 2, notes: true });
    setMsg(<span>Play your repertoire move</span>);
    setPhase("fix");
  };

  const addAlt = async () => {
    const gr = g.current;
    if (!gr || !altMove || !ask) return;
    await addMoves(gr.rep, [{ from: altMove.fen, uci: altMove.uci }]);
    const ng = await loadGraph(repId);
    if (ng) { g.current = ng; setGraph(ng); }
    setAltMove(undefined);
    const m = ng?.byFrom.get(posKey(altMove.fen))?.find((x) => x.uci === altMove.uci);
    if (m && ng) {
      if (!ask.wrong) await finish(ask, ask.fresh ? Rating.Good : ask.hint === 2 ? Rating.Again : ask.hint === 1 || ask.notes ? Rating.Hard : Rating.Good);
      setMsg(<span className="good">Added {m.san} to your repertoire</span>);
      playCorrect(ask, m);
    }
  };

  // ---------- Vista ----------

  const own = useMemo(() => (graph && ask ? ownMoves(graph, ask.fen) : []), [graph, ask]);
  const shapes = useMemo<DrawShape[]>(() => {
    const br = bonus?.result;
    if (phase === "bonusDone" && br) {
      const arrow = (u: string, brush: string) => ({ orig: u.slice(0, 2), dest: u.slice(2, 4), brush }) as DrawShape;
      return [
        ...(br.best ? [arrow(br.best.uci, "green")] : []),
        ...(br.played && br.played.uci !== br.best?.uci ? [arrow(br.played.uci, br.ok ? "blue" : "red")] : []),
      ];
    }
    if (!ask || !own.length || (phase !== "ask" && phase !== "fix")) return [];
    if (ask.hint === 2 || ask.fresh) return own.map((m) => ({ orig: m.uci.slice(0, 2), dest: m.uci.slice(2, 4), brush: "green" }) as DrawShape);
    if (ask.hint === 1) return own.map((m) => ({ orig: m.uci.slice(0, 2), brush: "green" }) as DrawShape);
    return [];
  }, [ask, own, phase, bonus]);

  const canMove = phase === "ask" || phase === "fix" || phase === "bonus";
  const boardDests = useMemo(() => (canMove ? dests(fen) : new Map<string, string[]>()), [canMove, fen]);

  if (!graph) return <p className="muted center">Loading…</p>;
  const color = graph.rep.color;
  const startNo = (i: number) => (i % 2 === 0 ? `${i / 2 + 1}.` : "");

  return (
    <div className="solver trainer">
      <div className="solver-top">
        <button className="btn ghost small" onClick={onExit}>← {graph.rep.name}</button>
        <span className="muted small">{score.done}/{score.total} · {score.done ? Math.round((score.correct / score.done) * 100) : 0}% ✓</span>
      </div>
      <ScrollStrip cursor={line.length}>
        {line.map((s, i) => <span key={i} className="mv"><span className="mv-no">{startNo(i)}</span>{s}</span>)}
        {!line.length && <span className="muted small">Starting position</span>}
      </ScrollStrip>

      <Board fen={fen} orientation={color} turnColor={turnOf(fen)} dests={boardDests} lastMove={lastMove}
             onMove={onMove} movableColor={color} shapes={shapes} />

      <div className="solver-bar">
        <p className="solver-msg">
          {phase === "done" ? <span className="good">Session complete</span>
            : msg ?? (phase === "ask" ? <><span className={`dot ${color}`} /> Your move</> : <span className="muted">…</span>)}
        </p>

        {(phase === "ask" || phase === "fix") && ask && (
          <div className="row">
            {!ask.fresh && phase === "ask" && (
              <button className="btn" disabled={ask.hint === 2} onClick={() => setAsk({ ...ask, hint: (ask.hint + 1) as 1 | 2 })}>
                {ask.hint === 0 ? "Hint" : "Show move"}
              </button>
            )}
            {own.some((m) => m.comment) && !ask.notes &&
              <button className="btn" onClick={() => setAsk({ ...ask, notes: true })}>Notes</button>}
          </div>
        )}
        {(phase === "ask" || phase === "fix" || phase === "wrong") && ask?.notes && own.filter((m) => m.comment).map((m) => (
          <p key={m.id} className="note"><strong>{m.san}</strong> {m.comment}</p>
        ))}
        {(phase === "ask" || phase === "fix") && altMove && altMove.fen === ask?.fen && <button className="btn" onClick={addAlt}>Add {altMove.san} to my repertoire</button>}
        {phase === "wrong" && <button className="btn primary" onClick={retry} autoFocus>Try again</button>}
        {phase === "bonus" && bonus && <>
          <p className="small muted">{bonus.b.reason}.</p>
          <div className="row">
            <button className="btn" onClick={() => answerBonus(bonus)}>I don't know</button>
            <button className="btn ghost" onClick={endBonus}>Skip</button>
          </div>
        </>}
        {phase === "bonusDone" && bonus && (
          <div className="row">
            {bonusAnswer && (
              <button className="btn" disabled={bonusAdded} onClick={addBonus}>
                {bonusAdded ? "✓ Added" : `Add ${bonus.b.san} ${bonusAnswer.san} to my repertoire`}
              </button>
            )}
            <button className="btn primary" onClick={endBonus} autoFocus>Continue</button>
          </div>
        )}

        {notes.length > 0 && phase !== "done" && (
          <div className="notes">
            {notes.map((n, i) => <p key={i} className="note muted"><strong>{n.san}</strong> {n.text}</p>)}
          </div>
        )}

        {phase === "done" && (
          <div className="card center">
            {score.total ? <p>{score.correct}/{score.done} correct first time.</p> : <p>Nothing due right now. 🎉</p>}
            {unreachable > 0 && <p className="small muted">{unreachable} position(s) couldn't be reached from the starting position.</p>}
            <button className="btn primary" onClick={onExit}>Back</button>
          </div>
        )}
      </div>
    </div>
  );
}

/** Compara la jugada con la mejor. `loss` = probabilidad de ganar perdida (0..1) para quien mueve. */
async function judge(fen: string, afterFen: string, uci: string) {
  const mover = turnOf(fen);
  const before = await getEval(fen, 5);
  const best = before?.lines[0];
  if (!best) return;
  const wc = (l: { cp?: number; mate?: number }) => (mover === "white" ? winChance(l) : 1 - winChance(l));

  let played: { cp?: number; mate?: number } | undefined;
  let refutation: string[] = [];
  const known = before.lines.find((l) => l.uci === uci);
  if (known) { played = known; refutation = known.pv.slice(1); }
  else {
    const after = new Chess(afterFen);
    if (after.isCheckmate()) played = { mate: mover === "white" ? 1 : -1 };
    else if (after.isDraw()) played = { cp: 0 };
    else {
      const e = await getEval(afterFen, 1);
      if (!e?.lines[0]) return;
      played = e.lines[0]; refutation = e.lines[0].pv;
    }
  }
  return { loss: wc(best) - wc(played), bestEval: fmtLine(best), playedEval: fmtLine(played), refutation };
}
