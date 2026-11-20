// Pantalla de inicio: qué toca hoy en cada parte (puzzles, aperturas, repaso) y un botón para cada una.
// La primera vez explica el método en lugar de mostrar contadores a cero.

import { useLiveQuery } from "dexie-react-hooks";
import { Progress } from "../components/charts";
import { db } from "../lib/db";
import { currentCycle, ritmo } from "../lib/cycles";
import { repertoireSummaries } from "../lib/openings/repertoire";
import { useSettings } from "../lib/settings";
import { goalStreak, pendingReviews, todayBreakdown } from "../lib/stats";
import { useSync } from "../lib/sync";

export type Target = "train" | "review" | "openings" | { train: string } | "data";

const greeting = () => {
  const h = new Date().getHours();
  return h < 5 ? "Good night" : h < 12 ? "Good morning" : h < 19 ? "Good afternoon" : "Good evening";
};

export function Home({ go }: { go: (t: Target) => void }) {
  const { dailyGoalMin, newCardsPerDay } = useSettings();
  const sync = useSync();
  const data = useLiveQuery(async () => {
    const [attempts, reviews, mistakes, cycle] = await Promise.all([
      db.attempts.toArray(), db.reviews.toArray(), db.gameMistakes.toArray(), currentCycle(),
    ]);
    return {
      cycle, pace: cycle && await ritmo(cycle),
      today: todayBreakdown(attempts, reviews),
      streak: goalStreak(attempts, reviews, dailyGoalMin),
      pending: pendingReviews(attempts, reviews, mistakes),
      reps: await repertoireSummaries(newCardsPerDay),
      fresh: !attempts.length && !reviews.length && !cycle,
    };
  }, [dailyGoalMin, newCardsPerDay]);

  if (!data) return <p className="muted center">Loading…</p>;
  const { cycle, pace, today, streak, pending, reps } = data;
  const total = pace ? pace.hechos + pace.restantes : 0;
  const due = reps.reduce((n, r) => n + r.due, 0), fresh = reps.reduce((n, r) => n + r.fresh, 0);
  const nextRep = [...reps].sort((a, b) => b.due + b.fresh - (a.due + a.fresh))[0];
  const toReview = pending.puzzles + pending.games;
  const cycleDone = !!pace && pace.restantes === 0;

  return (
    <div className="screen home">
      <header className="home-hero">
        <div>
          <h1>{greeting()}</h1>
          <p className="muted small">{new Date().toLocaleDateString("en-US", { weekday: "long", day: "numeric", month: "long" })}</p>
        </div>
        {streak > 0 && <span className="streak" title="Days in a row reaching your daily goal">🔥 {streak} day{streak > 1 ? "s" : ""}</span>}
      </header>

      {data.fresh ? (
        <section className="card intro">
          <h2>Train tactics the Woodpecker way</h2>
          <p className="muted">Solve the same set of 500 puzzles again and again, faster each time, until the patterns become automatic.</p>
          <ol className="steps">
            <li><strong>Cycle 1</strong> takes 28 days: about 18 puzzles a day.</li>
            <li>Each new cycle repeats the same puzzles in half the time: 14, 7, 4, 2 and 1 day.</li>
            <li>Take a break between cycles if you want: the clock starts when you press Start.</li>
          </ol>
          <p className="muted small">Also here: an opening trainer with spaced repetition, and a review of the puzzles you missed and the mistakes from your Lichess games.</p>
          <button className="btn primary" onClick={() => go("train")}>Get started</button>
          {sync.enabled && !sync.user && (
            <p className="small muted">Already training on another device? <button className="link" onClick={() => go("data")}>Sign in to sync</button> first.</p>
          )}
        </section>
      ) : (
        <section className="card">
          <div className="card-head"><h3>Today</h3><span className="small muted">goal {dailyGoalMin} min</span></div>
          <Progress value={today.total} max={dailyGoalMin}
                    label={<><span>{Math.round(today.total)} of {dailyGoalMin} min</span>
                      <span>{today.total >= dailyGoalMin ? <span className="good">Goal reached ✓</span> : `${Math.ceil(dailyGoalMin - today.total)} min to go`}</span></>} />
        </section>
      )}

      {!data.fresh && (
        <div className="home-grid">
          <section className="card home-card">
            <div className="card-head"><h3>♞ Tactics</h3>{cycle && <span className="pill">Cycle {cycle.n}</span>}</div>
            {pace && cycle && !cycleDone && <>
              <Progress value={pace.hechos} max={total} label={<><span>{pace.hechos} / {total} puzzles</span><span>{pace.diasRestantes} days left</span></>} />
              <p className="small muted">~{pace.porDia} a day to finish on time · {today.puzzlesCount} solved today</p>
            </>}
            {cycleDone && <p className="small">Cycle {cycle!.n} complete 🎉 Start the next one whenever you're ready.</p>}
            {!cycle && <p className="small muted">Your first cycle hasn't started yet.</p>}
            <button className="btn primary" onClick={() => go("train")}>
              {!cycle ? "Start cycle 1" : cycleDone ? `Start cycle ${cycle.n + 1}` : "Continue puzzles"}
            </button>
          </section>

          <section className="card home-card">
            <div className="card-head"><h3>♜ Openings</h3>{reps.length > 0 && <span className="small muted">{reps.length} repertoire{reps.length > 1 ? "s" : ""}</span>}</div>
            {!reps.length && <p className="small muted">Build a repertoire from the moves people play at your level, then drill it with spaced repetition.</p>}
            {reps.length > 0 && (
              <p className="small">{due + fresh ? <><strong>{due}</strong> due · <strong>{fresh}</strong> new today</> : <span className="good">All caught up ✓</span>}</p>
            )}
            {reps.length > 0 && due + fresh > 0
              ? <button className="btn primary" onClick={() => go({ train: nextRep.rep.id })}>Train {nextRep.rep.name}</button>
              : <button className="btn" onClick={() => go("openings")}>{reps.length ? "Open repertoires" : "Create a repertoire"}</button>}
          </section>

          <section className="card home-card">
            <div className="card-head"><h3>↺ Review</h3></div>
            {toReview
              ? <p className="small"><strong>{pending.puzzles}</strong> missed puzzle{pending.puzzles === 1 ? "" : "s"}{pending.games ? <> · <strong>{pending.games}</strong> game mistake{pending.games === 1 ? "" : "s"}</> : null}</p>
              : <p className="small muted">Nothing to review. Missed puzzles and mistakes from your Lichess games show up here.</p>}
            <button className={`btn ${toReview ? "primary" : ""}`} onClick={() => go("review")}>{toReview ? "Review mistakes" : "Open review"}</button>
          </section>
        </div>
      )}

      {!data.fresh && sync.enabled && !sync.user && (
        <p className="small muted center">Your progress is only on this device. <button className="link" onClick={() => go("data")}>Sign in to sync it</button></p>
      )}
    </div>
  );
}
