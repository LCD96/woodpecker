import { useState } from "react";
import { Card } from "../components/charts";
import { connectByUsername, disconnect, oauthAvailable, startLogin } from "../lib/lichess";
import { setSetting, useSettings } from "../lib/settings";

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
        <p className="small muted">Minutes of puzzle solving per day (cycle puzzles + reviews).</p>
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
        <p className="small muted">Used to import mistakes from your analysed games into the Review tab.</p>
      </Card>

      {msg && <p className="callout info">{msg}</p>}
    </div>
  );
}
