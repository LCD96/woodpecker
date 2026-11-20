import { useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { Card } from "../components/charts";
import { login, logout, syncNow, useSync } from "../lib/sync";
import { canShareFiles, exportData, localBackup, readBackup, restoreBackup, summarizeBackup, type Backup, type BackupSummary } from "../lib/backup";

const fmtDate = (iso?: string) => iso ? new Date(iso).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" }) : "—";

function SummaryTable({ s }: { s: BackupSummary }) {
  return (
    <table className="kv">
      <tbody>
        <tr><td>Current cycle</td><td>{s.cycle ? `#${s.cycle} · ${s.cycleDone}/${s.cycleTotal}` : "—"}</td></tr>
        <tr><td>Puzzle attempts</td><td>{s.attempts}</td></tr>
        <tr><td>Reviews</td><td>{s.reviews}</td></tr>
        <tr><td>Game mistakes</td><td>{s.gameMistakes}</td></tr>
        <tr><td>Opening moves</td><td>{s.repMoves ?? "—"}</td></tr>
        <tr><td>Puzzle set</td><td>{s.puzzles !== undefined ? `${s.puzzles} puzzles` : "not included (older backup)"}</td></tr>
        <tr><td>Last activity</td><td>{fmtDate(s.lastActivity)}</td></tr>
      </tbody>
    </table>
  );
}

const PHASE: Record<string, string> = {
  "initial": "Starting…", "not-in-sync": "Changes waiting to upload", "pushing": "Uploading…", "pulling": "Downloading…",
  "in-sync": "Up to date", "error": "Sync error", "offline": "Offline: changes will upload when you're back online",
};

function CloudCard() {
  const sync = useSync();
  const [err, setErr] = useState<string>();
  const run = (f: () => Promise<unknown>) => { setErr(undefined); f().catch((e: Error) => setErr(e.message)); };
  if (!sync.enabled) {
    return (
      <Card title="Cloud sync">
        <p className="small muted">This build has no sync server configured, so progress stays on this device.
          Use the backup file below to move it.</p>
      </Card>
    );
  }
  const lic = sync.user?.license;
  return (
    <Card title="Cloud sync" right={sync.user
      ? <div className="row">
          <button className="btn" onClick={() => run(syncNow)}>Sync now</button>
          <button className="btn ghost" onClick={() => run(logout)}>Sign out</button>
        </div>
      : <button className="btn primary" onClick={() => run(login)}>Sign in</button>}>
      {sync.user ? <>
        <p className="small">Signed in as <strong>{sync.user.email ?? sync.user.name ?? sync.user.userId}</strong></p>
        <p className={`small ${sync.state?.phase === "error" ? "bad" : "muted"}`}>
          {PHASE[sync.state?.phase ?? "initial"]}{sync.state?.progress !== undefined && sync.state.phase === "pulling" ? ` ${sync.state.progress}%` : ""}
          {sync.state?.error ? ` · ${sync.state.error.message}` : ""}
        </p>
        {lic?.type === "eval" && <p className="callout warn">Evaluation account{lic.evalDaysLeft !== undefined ? `: ${lic.evalDaysLeft} active days left` : ""}.
          Upgrade this user to production in Dexie Cloud Manager (free for up to 3 users) so syncing doesn't stop.</p>}
        {lic && lic.status !== "ok" && <p className="callout warn">Sync license {lic.status}: data stays on this device until it's fixed in Dexie Cloud Manager.</p>}
      </> : <>
        <p className="small muted">Sign in with your email (you get a one-time code, no password) and your progress, cycles,
          repertoires and settings sync to every device where you sign in. What's on this device now is uploaded to your account.</p>
        <p className="small muted">On a second device, sign in <strong>before</strong> training there.</p>
      </>}
      {err && <p className="callout warn">{err}</p>}
    </Card>
  );
}

export function Data() {
  const local = useLiveQuery(async () => summarizeBackup(await localBackup()), []);
  const [incoming, setIncoming] = useState<{ name: string; data: Backup; summary: BackupSummary }>();
  const [msg, setMsg] = useState<{ tone: "good" | "warn" | "info"; text: string }>();
  const [busy, setBusy] = useState(false);

  const pick = async (f?: File) => {
    setMsg(undefined); setIncoming(undefined);
    if (!f) return;
    try {
      const data = await readBackup(f);
      setIncoming({ name: f.name, data, summary: summarizeBackup(data) });
    } catch (e) { setMsg({ tone: "warn", text: (e as Error).message }); }
  };

  const restore = async () => {
    if (!incoming) return;
    setBusy(true);
    try {
      await restoreBackup(incoming.data);
      setIncoming(undefined);
      setMsg({ tone: "good", text: "Progress imported. You can continue your cycle in the Train tab." });
    } catch (e) { setMsg({ tone: "warn", text: (e as Error).message }); }
    setBusy(false);
  };

  const newerHere = incoming && local?.lastActivity && incoming.summary.lastActivity
    && local.lastActivity > incoming.summary.lastActivity;

  return (
    <div className="screen">
      <CloudCard />
      <Card title="Backup file">
        <ol className="steps small">
          <li><strong>Download</strong> the backup file on this device, or <strong>Share…</strong> it straight to Drive, email or a chat.</li>
          <li>To restore it, or to move progress without signing in, <strong>Import</strong> the file on this tab.</li>
        </ol>
        <p className="small muted">The file contains your cycles (with their puzzle order), every attempt, reviews,
          imported game mistakes, opening repertoires, settings, and the full puzzle set.
          Your Lichess login is not included.</p>
      </Card>

      <Card title="This device" right={<div className="row">
        {canShareFiles() && <button className="btn" onClick={() => exportData("share").catch((e) => e.name !== "AbortError" && setMsg({ tone: "warn", text: e.message }))}>Share…</button>}
        <button className="btn primary" onClick={() => exportData().catch((e) => setMsg({ tone: "warn", text: e.message }))}>Download</button>
      </div>}>
        {local ? <SummaryTable s={local} /> : <p className="muted small">Loading…</p>}
      </Card>

      <Card title="Import">
        <label className="btn">
          Choose backup file…
          <input type="file" accept="application/json,.json" hidden onChange={(e) => { pick(e.target.files?.[0]); e.target.value = ""; }} />
        </label>
        {incoming && <>
          <p className="small muted">{incoming.name} · exported {fmtDate(incoming.data.exportedAt)}</p>
          <SummaryTable s={incoming.summary} />
          {newerHere && <p className="callout warn">This device has more recent activity ({fmtDate(local?.lastActivity)}) than the backup. Importing will lose it — export here first if unsure.</p>}
          <p className="callout info">Importing <strong>replaces</strong> all progress on this device and, if you're signed in to sync, on your other devices too.</p>
          <div className="row">
            <button className="btn primary" disabled={busy} onClick={restore}>{busy ? "Importing…" : "Replace and import"}</button>
            <button className="btn ghost" onClick={() => setIncoming(undefined)}>Cancel</button>
          </div>
        </>}
      </Card>
      {msg && <p className={`callout ${msg.tone}`}>{msg.text}</p>}
    </div>
  );
}
