import { useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { Card } from "../components/charts";
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
        <tr><td>Puzzle set</td><td>{s.puzzles !== undefined ? `${s.puzzles} puzzles` : "not included (older backup)"}</td></tr>
        <tr><td>Last activity</td><td>{fmtDate(s.lastActivity)}</td></tr>
      </tbody>
    </table>
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
      <Card title="Move your progress to another device">
        <ol className="steps small">
          <li><strong>Download</strong> the backup file on this device, or <strong>Share…</strong> it straight to Drive, email or a chat.</li>
          <li>Open Woodpecker on the other device, go to this tab, and <strong>Import</strong> the file.</li>
        </ol>
        <p className="small muted">The file contains your cycles (with their puzzle order), every attempt, reviews,
          imported game mistakes, settings, and the full puzzle set, so the other device continues exactly where you left off.
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
          <p className="callout info">Importing <strong>replaces</strong> all progress on this device.</p>
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
