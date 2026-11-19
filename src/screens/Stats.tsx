import { useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { BarChart, Card, Progress, Radar, Stat, type RadarSeries } from "../components/charts";
import { db } from "../lib/db";
import { useSettings } from "../lib/settings";
import {
  calibration, categoryAccuracy, cycleStats, daily, efficiency, fmtPct, fmtSec, goalStreak,
  minutesToday, prettyTheme, ratingBuckets, summarize, themeAccuracy, type ThemeAcc,
} from "../lib/stats";
import { usePuzzleMap } from "../lib/puzzleSet";

export function Stats() {
  const data = useLiveQuery(async () => ({
    attempts: await db.attempts.toArray(),
    reviews: await db.reviews.toArray(),
    cycles: await db.cycles.orderBy("n").toArray(),
  }), []);
  const { dailyGoalMin } = useSettings();
  const [mode, setMode] = useState<"categories" | "themes">("categories");
  const [scope, setScope] = useState<number>(0);   // 0 = todos los ciclos

  const byId = usePuzzleMap();

  if (!data || !byId) return <div className="screen"><p className="muted center">Loading…</p></div>;
  const { attempts, reviews, cycles } = data;
  const cur = cycles.at(-1);
  const curAtt = attempts.filter((a) => a.cycle === cur?.n);
  const all = summarize(attempts), curS = summarize(curAtt), base = summarize(attempts.filter((a) => a.cycle === 1));
  const eff = efficiency(curS, base);
  const cal = calibration(all.accuracy, all.count);
  const today = minutesToday(attempts, reviews);
  const days = daily(attempts, reviews, 7);
  const cyc = cycleStats(attempts, cycles);
  const streak = goalStreak(attempts, reviews, dailyGoalMin);

  // Radar
  const scoped = scope ? attempts.filter((a) => a.cycle === scope) : attempts;
  const acc = (as: typeof attempts): ThemeAcc[] => mode === "categories" ? categoryAccuracy(as, byId) : themeAccuracy(as, byId);
  let main = acc(scoped);
  if (mode === "themes") main = main.filter((t) => t.attempts >= 3).slice(0, 16);
  const pick = (list: ThemeAcc[]) => main.map((m) => list.find((x) => x.name === m.name) ?? { ...m, attempts: 0, accuracy: 0 });
  const toAxes = (list: ThemeAcc[]) => list.map((t) => ({ name: mode === "themes" ? prettyTheme(t.name) : t.name, value: t.accuracy, attempts: t.attempts }));
  const series: RadarSeries[] = [{ name: scope ? `Cycle ${scope}` : "All cycles", axes: toAxes(main), color: "var(--series-1)" }];
  if (scope !== 1 && cycles.length > 1 && base.count) {
    series.push({ name: "Cycle 1", axes: toAxes(pick(acc(attempts.filter((a) => a.cycle === 1)))), color: "var(--series-2)", dashed: true });
  }
  const weakest = themeAccuracy(attempts, byId).filter((t) => t.attempts >= 10).sort((a, b) => a.accuracy - b.accuracy).slice(0, 5);
  const ratings = ratingBuckets(attempts, byId);

  if (!attempts.length) {
    return <div className="screen"><Card title="No data yet"><p className="muted">Solve a few puzzles in the Train tab and your stats will show up here.</p></Card></div>;
  }

  return (
    <div className="screen stats">
      <div className="tiles">
        <Stat label="Current cycle" value={`#${cur?.n ?? 1}`} sub={`${curAtt.length}/${cur?.order.length ?? 0} · target ${cur?.targetDays}d`} />
        <Stat label="Overall accuracy" value={fmtPct(all.accuracy)} sub={`${all.count} puzzles`}
              tone={cal.level === "good" ? "good" : cal.level === "warn" ? "warn" : undefined} />
        <Stat label="Avg solve time" value={fmtSec(curS.avgTimeMs)} sub={`this cycle · ${fmtSec(all.avgTimeMs)} overall`} />
        <Stat label="Efficiency" value={eff ? Math.round(eff) : "—"}
              sub={cur?.n === 1 ? "cycle 1 = 100 baseline" : "vs cycle 1 = 100"}
              tone={eff && cur?.n !== 1 ? (eff >= 100 ? "good" : "bad") : undefined} />
      </div>

      <Card title="Daily goal" right={<span className="muted small">🔥 {streak} day streak</span>}>
        <Progress value={today} max={dailyGoalMin} label={<><span>Today</span><span>{Math.floor(today)} / {dailyGoalMin} min</span></>} />
      </Card>

      <Card title="Rating calibration">
        <p className={`callout ${cal.level}`}>{cal.text}</p>
        <p className="small muted">Woodpecker works best when you solve most but not all puzzles on the first pass.
          Set accuracy: {fmtPct(all.accuracy)} · current cycle: {curAtt.length ? fmtPct(curS.accuracy) : "—"}</p>
        {ratings.length > 1 && <BarChart color="var(--series-1)" height={120}
          data={ratings.map((r) => ({ label: r.label, value: r.accuracy * 100, display: `${fmtPct(r.accuracy)} of ${r.attempts}` }))} />}
      </Card>

      <Card title="Skill map" right={
        <div className="seg">
          <button className={mode === "categories" ? "on" : ""} onClick={() => setMode("categories")}>Categories</button>
          <button className={mode === "themes" ? "on" : ""} onClick={() => setMode("themes")}>All themes</button>
        </div>}>
        <div className="chips">
          <button className={scope === 0 ? "on" : ""} onClick={() => setScope(0)}>All cycles</button>
          {cycles.map((c) => <button key={c.n} className={scope === c.n ? "on" : ""} onClick={() => setScope(c.n)}>Cycle {c.n}</button>)}
        </div>
        <Radar series={series} />
        {weakest.length > 0 && <p className="small muted center">Weakest: {weakest.map((t) => `${prettyTheme(t.name)} ${fmtPct(t.accuracy)}`).join(" · ")}</p>}
      </Card>

      <h2 className="section">Last 7 days</h2>
      <div className="grid2">
        <Card title="Time spent">
          <BarChart data={days.map((d) => ({ label: d.label, value: d.minutes, display: `${Math.round(d.minutes)} min` }))}
                    goal={dailyGoalMin} goalLabel={`goal ${dailyGoalMin}m`} />
        </Card>
        <Card title="Puzzles completed">
          <BarChart data={days.map((d) => ({ label: d.label, value: d.count, display: `${d.count}` }))} />
        </Card>
        <Card title="Avg solving time">
          <BarChart color="var(--series-2)" data={days.map((d) => ({ label: d.label, value: d.avgTimeMs / 1000, display: fmtSec(d.avgTimeMs) }))} />
        </Card>
        <Card title="Accuracy">
          <BarChart color="var(--series-3)" data={days.map((d) => ({ label: d.label, value: d.accuracy * 100, display: d.count ? fmtPct(d.accuracy) : "—" }))} />
        </Card>
        <Card title="Efficiency (cycle 1 = 100)">
          <BarChart color="var(--series-7)" goal={100} goalLabel="baseline"
                    data={days.map((d) => { const e = efficiency(d, base); return { label: d.label, value: e ?? 0, display: e ? `${Math.round(e)}` : "—" }; })} />
        </Card>
      </div>

      <Card title="Cycles">
        <div className="table-wrap">
          <table>
            <thead><tr><th>#</th><th>Done</th><th>Days</th><th>Accuracy</th><th>Avg time</th><th>Efficiency</th></tr></thead>
            <tbody>
              {cyc.map((c) => (
                <tr key={c.n}>
                  <td>{c.n}</td>
                  <td>{c.count}/{c.total}</td>
                  <td className={c.daysTaken > c.targetDays ? "bad" : ""}>{c.daysTaken.toFixed(1)} / {c.targetDays}</td>
                  <td>{c.count ? fmtPct(c.accuracy) : "—"}</td>
                  <td>{fmtSec(c.avgTimeMs)}</td>
                  <td>{c.efficiency ? Math.round(c.efficiency) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="small muted">Efficiency = ((accuracy ÷ cycle-1 accuracy) + (cycle-1 avg time ÷ avg time)) ÷ 2 × 100.
          Above 100 means you're more accurate, faster, or both, than in cycle 1.</p>
      </Card>
    </div>
  );
}
