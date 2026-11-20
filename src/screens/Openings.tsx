import { useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { Card } from "../components/charts";
import { OpeningTrainer } from "../components/OpeningTrainer";
import { RepertoireEditor } from "../components/RepertoireEditor";
import { db } from "../lib/db";
import { buildGraph, createRepertoire, deleteRepertoire, isMine, reachable, renameRepertoire } from "../lib/openings/repertoire";
import { isNew, sessionCards } from "../lib/openings/srs";
import { useSettings } from "../lib/settings";

type View = { kind: "list" } | { kind: "edit"; repId: string } | { kind: "train"; repId: string };

export function Openings() {
  const [view, setView] = useState<View>({ kind: "list" });
  const back = () => setView({ kind: "list" });
  return (
    <div className="screen">
      {view.kind === "list" && <RepertoireList onEdit={(repId) => setView({ kind: "edit", repId })} onTrain={(repId) => setView({ kind: "train", repId })} />}
      {view.kind === "edit" && <RepertoireEditor repId={view.repId} onExit={back} />}
      {view.kind === "train" && <OpeningTrainer key={view.repId} repId={view.repId} onExit={back} />}
    </div>
  );
}

function RepertoireList({ onEdit, onTrain }: { onEdit: (id: string) => void; onTrain: (id: string) => void }) {
  const { newCardsPerDay } = useSettings();
  const data = useLiveQuery(async () => {
    const [reps, moves, cards] = await Promise.all([db.repertoires.toArray(), db.repMoves.toArray(), db.cards.toArray()]);
    return reps.sort((a, b) => a.created.localeCompare(b.created)).map((rep) => {
      const g = buildGraph(rep, moves.filter((m) => m.repId === rep.id));
      const live = reachable(g);
      const mineAt = new Set(g.moves.filter((m) => isMine(rep, m.from)).map((m) => m.from));
      const repCards = cards.filter((c) => c.repId === rep.id && live.has(c.pos) && mineAt.has(c.pos));
      const { due, fresh } = sessionCards(repCards, cards, newCardsPerDay);
      return { rep, moves: g.moves.length, positions: repCards.length, unseen: repCards.filter(isNew).length, due: due.length, fresh: fresh.length };
    });
  }, [newCardsPerDay]);
  const [name, setName] = useState("");
  const [color, setColor] = useState<"white" | "black">("white");

  if (!data) return <p className="muted center">Loading…</p>;
  return (
    <>
      {data.map(({ rep, moves, positions, unseen, due, fresh }) => (
        <Card key={rep.id} title={<><span className={`dot ${rep.color}`} /> {rep.name}</>}
              right={<div className="row">
                <button className="btn" onClick={() => onEdit(rep.id)}>Edit</button>
                <button className="btn primary" disabled={!due && !fresh} onClick={() => onTrain(rep.id)}>
                  Train{due + fresh ? ` (${due + fresh})` : ""}
                </button>
              </div>}>
          <p className="small muted">
            {moves} moves · {positions} positions to know · {due} due{fresh ? ` · ${fresh} new today` : ""}{unseen > fresh ? ` (${unseen - fresh} more waiting)` : ""}
          </p>
          <details className="small">
            <summary className="muted">Manage</summary>
            <div className="row">
              <button className="btn small" onClick={() => { const n = prompt("New name", rep.name); if (n?.trim()) renameRepertoire(rep.id, n.trim()); }}>Rename</button>
              <button className="btn small ghost" onClick={() => { if (confirm(`Delete "${rep.name}" with all its moves, notes and progress?`)) deleteRepertoire(rep.id); }}>Delete</button>
            </div>
          </details>
        </Card>
      ))}

      <Card title="New repertoire">
        <form className="row" onSubmit={async (e) => { e.preventDefault(); const r = await createRepertoire(name, color); setName(""); onEdit(r.id); }}>
          <input placeholder="Name (e.g. Italian Game)" value={name} onChange={(e) => setName(e.target.value)} />
          <div className="chips">
            {(["white", "black"] as const).map((c) => (
              <button type="button" key={c} className={color === c ? "on" : ""} onClick={() => setColor(c)}>{c === "white" ? "White" : "Black"}</button>
            ))}
          </div>
          <button className="btn primary">Create</button>
        </form>
        {!data.length && <p className="small muted">Build your lines move by move with the engine and the Lichess explorer (games at your rating),
          or import a PGN / Lichess study. Then train them here with spaced repetition: positions you know come back less often.</p>}
      </Card>
    </>
  );
}
