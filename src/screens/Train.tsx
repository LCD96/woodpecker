// Flujo:
// 1. Carga el ciclo actual y el siguiente puzzle con nextPuzzleId()
// 2. <PuzzleSolver> juega el puzzle y devuelve el resultado
// 3. Guardamos el intento y, con "Next", cargamos el siguiente

import { useCallback, useEffect, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { PuzzleSolver, type SolveResult } from "../components/PuzzleSolver";
import { Progress } from "../components/charts";
import { db, type Cycle, type Puzzle } from "../lib/db";
import { currentCycle, nextPuzzleId, ritmo, startNextCycle } from "../lib/cycles";
import { useSettings } from "../lib/settings";
import { minutesToday } from "../lib/stats";

export function Train() {
  const [cycle, setCycle] = useState<Cycle>();
  const [puzzle, setPuzzle] = useState<Puzzle>();
  const [done, setDone] = useState(false);
  const [pace, setPace] = useState<Awaited<ReturnType<typeof ritmo>>>();
  const { dailyGoalMin } = useSettings();
  const today = useLiveQuery(async () => minutesToday(await db.attempts.toArray(), await db.reviews.toArray()), [], 0);

  const loadNext = useCallback(async (c: Cycle) => {
    setPace(await ritmo(c));
    const id = await nextPuzzleId(c);
    const p = id ? await db.puzzles.get(id) : undefined;
    setPuzzle(p);
    setDone(!p);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      let c = await currentCycle();
      if (!c) { await startNextCycle(); c = await currentCycle(); }
      if (!cancelled && c) { setCycle(c); await loadNext(c); }
    })();
    return () => { cancelled = true; };
  }, [loadNext]);

  const onResult = useCallback(async (r: SolveResult) => {
    if (!puzzle || !cycle) return;
    await db.attempts.add({ puzzleId: puzzle.id, cycle: cycle.n, ...r, date: new Date().toISOString() });
    setPace(await ritmo(cycle));
  }, [puzzle, cycle]);

  const nextCycle = async () => {
    if (!cycle) return;
    await db.cycles.update(cycle.n, { end: new Date().toISOString() });
    await startNextCycle();
    const c = await currentCycle();
    if (c) { setCycle(c); await loadNext(c); }
  };

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
          <p className="muted">Check the Stats tab to compare it with your earlier cycles.</p>
          <button className="btn primary" onClick={nextCycle}>Start cycle {(cycle?.n ?? 0) + 1}</button>
        </div>
      )}
      {!puzzle && !done && <p className="muted center">Loading…</p>}
    </div>
  );
}
