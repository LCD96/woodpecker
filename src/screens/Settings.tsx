import { useState } from "react";
import { Card } from "../components/charts";
import { connectByUsername, disconnect, oauthAvailable, startLogin } from "../lib/lichess";
import { setSetting, useSettings } from "../lib/settings";
import { RATING_BUCKETS, SPEEDS } from "../lib/openings/explorer";

const TOLERANCE = [
  { v: 0.08, label: "Lenient" },
  { v: 0.05, label: "Normal" },
  { v: 0.03, label: "Strict" },
];

const toggle = <T,>(xs: T[], x: T) => (xs.includes(x) ? xs.filter((y) => y !== x) : [...xs, x]);

const GOALS = [10, 15, 20, 30, 45, 60, 90];

export function Settings() {
  const s = useSettings();
  const [name, setName] = useState("");
  const [msg, setMsg] = useState<string>();

  const run = async (f: () => Promise<unknown>, ok?: string) => {
    setMsg(undefined);
    try { await f(); if (ok) setMsg(ok); } catch (e) { setMsg((e as Error).message); }
  };

  return (
    <div className="screen">
      <Card title="Daily goal">
        <p className="small muted">Minutes of training per day: cycle puzzles, reviews and opening practice.</p>
        <div className="chips">
          {GOALS.map((g) => <button key={g} className={s.dailyGoalMin === g ? "on" : ""} onClick={() => setSetting("dailyGoalMin", g)}>{g} min</button>)}
        </div>
        <label className="field">
          Custom
          <input type="number" min={1} max={600} value={s.dailyGoalMin}
                 onChange={(e) => { const v = +e.target.value; if (v > 0) setSetting("dailyGoalMin", v); }} />
          min/day
        </label>
      </Card>

      <Card title="Lichess">
        {s.lichessUser ? (
          <div className="row between">
            <span>Connected as <strong>{s.lichessUser}</strong>{s.lichessToken ? "" : <span className="muted small"> (username only)</span>}</span>
            <button className="btn" onClick={() => run(disconnect)}>Disconnect</button>
          </div>
        ) : (
          <>
            {oauthAvailable()
              ? <button className="btn primary lichess" onClick={() => run(startLogin)}>Log in with Lichess</button>
              : <p className="small muted">Lichess login needs HTTPS. You can still connect with just your username:</p>}
            <form className="row" onSubmit={(e) => { e.preventDefault(); run(() => connectByUsername(name)); }}>
              <input placeholder="Lichess username" value={name} onChange={(e) => setName(e.target.value)} />
              <button className="btn" disabled={!name.trim()}>Connect</button>
            </form>
          </>
        )}
        <p className="small muted">Used to import mistakes from your analysed games into the Review tab, and for the
          opening explorer at your rating (Lichess only allows it when you log in; with just a username you get master games).</p>
      </Card>

      <Card title="Openings">
        <p className="small">Explorer</p>
        <div className="chips">
          <button className={s.explorerSource === "lichess" ? "on" : ""} onClick={() => setSetting("explorerSource", "lichess")}>Lichess players</button>
          <button className={s.explorerSource === "masters" ? "on" : ""} onClick={() => setSetting("explorerSource", "masters")}>Masters</button>
        </div>
        {s.explorerSource === "lichess" && <>
          <p className="small">Ratings</p>
          <div className="chips">
            {RATING_BUCKETS.map((r) => <button key={r} className={s.explorerRatings.includes(r) ? "on" : ""}
              onClick={() => { const v = toggle(s.explorerRatings, r).sort((a, b) => a - b); if (v.length) setSetting("explorerRatings", v); }}>{r}+</button>)}
          </div>
          <p className="small">Time controls</p>
          <div className="chips">
            {SPEEDS.map((x) => <button key={x} className={s.explorerSpeeds.includes(x) ? "on" : ""}
              onClick={() => { const v = toggle(s.explorerSpeeds, x); if (v.length) setSetting("explorerSpeeds", v); }}>{x}</button>)}
          </div>
        </>}
        <p className="small">Moves outside your repertoire</p>
        <div className="chips">
          {TOLERANCE.map((t) => <button key={t.v} className={s.openingTolerance === t.v ? "on" : ""} onClick={() => setSetting("openingTolerance", t.v)}>{t.label}</button>)}
        </div>
        <p className="small muted">A different move only counts as a mistake if it loses more than {Math.round(s.openingTolerance * 100)}% winning
          chances compared with the best move (about {Math.round(Math.log(1 / (0.5 - s.openingTolerance) - 1) / 0.00368208)} centipawns in a level position). Otherwise you just try again.</p>
        <label className="field">
          New positions per day
          <input type="number" min={0} max={200} value={s.newCardsPerDay}
                 onChange={(e) => { const v = +e.target.value; if (v >= 0) setSetting("newCardsPerDay", v); }} />
        </label>
      </Card>

      {msg && <p className="callout info">{msg}</p>}
    </div>
  );
}
