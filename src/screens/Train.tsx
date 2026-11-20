// Flujo:
// 1. Carga el ciclo actual y el siguiente puzzle con nextPuzzleId()
// 2. <PuzzleSolver> juega el puzzle y devuelve el resultado
// 3. Guardamos el intento y, con "Next", cargamos el siguiente

import { useCallback, useEffect, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { PuzzleSolver, type SolveResult } from "../components/PuzzleSolver";
import { Ring } from "../components/charts";
import { db, newId, type Cycle, type Puzzle } from "../lib/db";
import { useSync } from "../lib/sync";
import { PLAZOS, currentCycle, finishCycle, nextPuzzleId, ritmo, startNextCycle } from "../lib/cycles";
import { useSettings } from "../lib/settings";
import { todayBreakdown } from "../lib/stats";

export function Train() {
  const cycle = useLiveQuery(async () => (await currentCycle()) ?? null, []);
  const [puzzle, setPuzzle] = useState<Puzzle>();
  const [done, setDone] = useState(false);
  const [pace, setPace] = useState<Awaited<ReturnType<typeof ritmo>>>();
  const { dailyGoalMin } = useSettings();
  const sync = useSync();
  const today = useLiveQuery(async () => todayBreakdown(await db.attempts.toArray(), await db.reviews.toArray()));
  const [open, setOpen] = useState<"cycle" | "today">();
  const toggle = (w: "cycle" | "today") => setOpen(open === w ? undefined : w);

  const loadNext = useCallback(async (c: Cycle) => {
    setPace(await ritmo(c));
    const id = await nextPuzzleId(c);
    const p = id ? await db.puzzles.get(id) : undefined;
    setPuzzle(p);
    setDone(!p);
    if (!id) await finishCycle(c);
  }, []);

  // Solo al cambiar de ciclo (no en cada actualización del objeto): si no, se saltaría el puzzle en curso
  const cycleKey = cycle ? `${cycle.id}|${cycle.start}` : cycle;
  useEffect(() => {
    let cancelled = false;
    (async () => { if (cycle && !cancelled) await loadNext(cycle); })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cycleKey, loadNext]);

  const onResult = useCallback(async (r: SolveResult) => {
    if (!puzzle || !cycle) return;
    await db.attempts.add({ id: newId(), puzzleId: puzzle.id, cycle: cycle.n, ...r, date: new Date().toISOString() });
    setPace(await ritmo(cycle));
  }, [puzzle, cycle]);

  if (cycle === null) {
    return (
      <div className="screen">
        <div className="card center">
          <h2>Ready for cycle 1?</h2>
          <p className="muted">Your first cycle has {PLAZOS[0]} days. The clock starts when you press the button.</p>
          {sync.waitingFirstSync && <p className="callout info">Downloading your progress from the cloud…</p>}
          {sync.enabled && !sync.user && <p className="small muted">Already training on another device? Sign in on the Sync tab first so this device continues that cycle.</p>}
          <button className="btn primary" disabled={sync.waitingFirstSync} onClick={startNextCycle}>Start cycle 1</button>
        </div>
      </div>
    );
  }

  const total = pace ? pace.hechos + pace.restantes : 0;

  return (
    <div className="screen train">
      <div className="train-head">
        <span className="pill">Cycle {cycle?.n ?? "…"}</span>
        {puzzle && <span className="muted small">★ {puzzle.rating}</span>}
        <span className="grow" />
        {pace && cycle && (
          <Ring value={pace.hechos} max={total} label={`${pace.hechos}/${total}`} open={open === "cycle"} onToggle={() => toggle("cycle")}>
            <CycleInfo cycle={cycle} pace={pace} />
          </Ring>
        )}
        {today && (
          <Ring value={today.total} max={dailyGoalMin} label="today" open={open === "today"} onToggle={() => toggle("today")}>
            <TodayInfo today={today} goal={dailyGoalMin} />
          </Ring>
        )}
      </div>
      {open && <div className="popover-scrim" onClick={() => setOpen(undefined)} />}

      {puzzle && cycle && (
        <PuzzleSolver key={`${cycle.n}-${puzzle.id}`} puzzle={puzzle} onResult={onResult} onNext={() => loadNext(cycle)} />
      )}
      {done && (
        <div className="card center">
          <h2>Cycle {cycle?.n} complete 🎉</h2>
          <p className="muted">Check the Stats tab to compare it with your earlier cycles. Take a break if you like: the next cycle's clock starts when you press the button.</p>
          <button className="btn primary" onClick={startNextCycle}>Start cycle {(cycle?.n ?? 0) + 1}</button>
        </div>
      )}
      {!puzzle && !done && <p className="muted center">Loading…</p>}
    </div>
  );
}

const fmtMin = (m: number) => (m >= 60 ? `${Math.floor(m / 60)} h ${Math.round(m % 60)} min` : `${Math.round(m)} min`);
const fmtDate = (t: number) => new Date(t).toLocaleDateString("en-US", { weekday: "short", day: "numeric", month: "short" });

function CycleInfo({ cycle, pace }: { cycle: Cycle; pace: Awaited<ReturnType<typeof ritmo>> }) {
  const total = pace.hechos + pace.restantes;
  const late = pace.finEstimado !== undefined && pace.finEstimado > pace.fin;
  const daysLate = pace.finEstimado !== undefined ? Math.ceil((pace.finEstimado - pace.fin) / 86400000) : 0;
  return (
    <>
      <h3>Cycle {cycle.n}</h3>
      <p><strong>{pace.hechos}</strong> of {total} puzzles · <strong>{Math.round((pace.hechos / (total || 1)) * 100)}%</strong></p>
      {pace.acierto !== undefined && <p className="small">First-try accuracy: <strong>{Math.round(pace.acierto * 100)}%</strong></p>}
      <p className="small">Deadline {fmtDate(pace.fin)} · {pace.diasRestantes} day{pace.diasRestantes === 1 ? "" : "s"} left</p>
      <p className="small">Needed from now: <strong>~{pace.porDia}</strong> puzzles/day</p>
      <p className="small">Your pace so far: <strong>{pace.ritmoReal.toFixed(1)}</strong> puzzles/day</p>
      {pace.restantes > 0 && pace.hechos >= 10 && pace.finEstimado !== undefined && (
        <p className={`small ${late ? "warn" : "good"}`}>
          At this pace you'll finish on {fmtDate(pace.finEstimado)}{late ? `, ${daysLate} day${daysLate === 1 ? "" : "s"} after the deadline.` : ", in time."}
        </p>
      )}
    </>
  );
}

function TodayInfo({ today, goal }: { today: ReturnType<typeof todayBreakdown>; goal: number }) {
  const left = goal - today.total;
  return (
    <>
      <h3>Today</h3>
      <p><strong>{fmtMin(today.total)}</strong> of {goal} min · <strong>{Math.floor((today.total / goal) * 100)}%</strong> of your goal</p>
      <p className="small">{left > 0 ? <>{fmtMin(left)} to go</> : <span className="good">Goal reached ✓</span>}</p>
      <table className="kv small">
        <tbody>
          <tr><td>Puzzles ({today.puzzlesCount})</td><td>{fmtMin(today.puzzles)}</td></tr>
          <tr><td>Review</td><td>{fmtMin(today.review)}</td></tr>
          <tr><td>Openings</td><td>{fmtMin(today.openings)}</td></tr>
        </tbody>
      </table>
      <p className="tiny muted">Only solving time counts, not time on other screens.</p>
    </>
  );
}
