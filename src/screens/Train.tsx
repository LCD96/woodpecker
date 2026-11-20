// Flujo:
// 1. Carga el ciclo actual y el siguiente puzzle con nextPuzzleId()
// 2. <PuzzleSolver> juega el puzzle y devuelve el resultado
// 3. Guardamos el intento y, con "Next", cargamos el siguiente

import { useCallback, useEffect, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { PuzzleSolver, type SolveResult } from "../components/PuzzleSolver";
import { Progress } from "../components/charts";
import { db, newId, type Cycle, type Puzzle } from "../lib/db";
import { useSync } from "../lib/sync";
import { PLAZOS, currentCycle, finishCycle, nextPuzzleId, ritmo, startNextCycle } from "../lib/cycles";
import { useSettings } from "../lib/settings";
import { minutesToday } from "../lib/stats";

export function Train() {
  const cycle = useLiveQuery(async () => (await currentCycle()) ?? null, []);
  const [puzzle, setPuzzle] = useState<Puzzle>();
  const [done, setDone] = useState(false);
  const [pace, setPace] = useState<Awaited<ReturnType<typeof ritmo>>>();
  const { dailyGoalMin } = useSettings();
  const sync = useSync();
  const today = useLiveQuery(async () => minutesToday(await db.attempts.toArray(), await db.reviews.toArray()), [], 0);

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
        <div className="train-meta">
          <span className="pill">Cycle {cycle?.n ?? "…"}</span>
          {pace && <span className="muted small">{pace.hechos}/{total} · ~{pace.porDia}/day · {pace.diasRestantes}d left</span>}
          {puzzle && <span className="muted small">★ {puzzle.rating}</span>}
        </div>
        {pace && <Progress value={pace.hechos} max={total} />}
        <Progress value={today} max={dailyGoalMin}
                  label={<><span>Today</span><span>{Math.floor(today)} / {dailyGoalMin} min</span></>} />
      </div>

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
