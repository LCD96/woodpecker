import { useCallback, useState, type ReactNode } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { PuzzleSolver, type SolveResult } from "../components/PuzzleSolver";
import { Card } from "../components/charts";
import { db, newId, type Attempt, type GameMistake, type Puzzle, type Review as ReviewRow } from "../lib/db";
import { syncGames } from "../lib/lichess";
import { useSettings } from "../lib/settings";
import { fmtSec, prettyTheme } from "../lib/stats";
import { usePuzzleMap } from "../lib/puzzleSet";


interface Item {
  key: string;
  puzzle: Puzzle;
  title: string;
  sub: string;
  cleared: boolean;          // resuelto en un repaso posterior al último fallo
  hint?: ReactNode;
}

/** ¿Hay un repaso correcto posterior a `since`? */
const clearedSince = (reviews: ReviewRow[], since: string) => reviews.some((r) => r.correct && r.date > since);

function puzzleItems(attempts: Attempt[], reviews: ReviewRow[], byId: Map<string, Puzzle>): Item[] {
  const byPuzzle = new Map<string, Attempt[]>();
  for (const a of attempts) byPuzzle.set(a.puzzleId, [...(byPuzzle.get(a.puzzleId) ?? []), a]);
  const revs = new Map<string, ReviewRow[]>();
  for (const r of reviews) if (r.kind === "puzzle") revs.set(r.refId, [...(revs.get(r.refId) ?? []), r]);

  return [...byPuzzle].flatMap(([id, as]) => {
    const fails = as.filter((a) => !a.correct);
    const p = byId.get(id);
    if (!fails.length || !p) return [];
    const lastFail = fails.reduce((a, b) => (a.date > b.date ? a : b));
    const failedCycles = new Set(fails.map((a) => a.cycle)).size;
    return [{
      key: id, puzzle: p,
      title: `${p.themes.filter((t) => !["short", "long", "veryLong", "advantage", "crushing", "middlegame", "endgame", "master"].includes(t)).slice(0, 3).map(prettyTheme).join(", ") || "Puzzle"}`,
      sub: `★${p.rating} · missed ${fails.length}/${as.length}${failedCycles > 1 ? " · ⚠ blind spot" : ""} · last ${new Date(lastFail.date).toLocaleDateString("en-US")}`,
      cleared: clearedSince(revs.get(id) ?? [], lastFail.date),
    }];
  }).sort((a, b) => Number(a.cleared) - Number(b.cleared));
}

function gameItems(mistakes: GameMistake[], reviews: ReviewRow[]): Item[] {
  const revs = new Map<string, ReviewRow[]>();
  for (const r of reviews) if (r.kind === "game") revs.set(r.refId, [...(revs.get(r.refId) ?? []), r]);
  return [...mistakes].sort((a, b) => b.date.localeCompare(a.date)).map((m) => ({
    key: m.id,
    puzzle: { id: m.id, fen: m.fen, moves: m.moves, rating: 0, themes: [] },
    title: `${m.judgment === "Blunder" ? "?? Blunder" : "? Mistake"} · move ${Math.floor(m.ply / 2) + 1} vs ${m.opponent}`,
    sub: `${m.speed} · ${m.opening ?? ""} · ${new Date(m.date).toLocaleDateString("en-US")}`,
    cleared: (revs.get(m.id) ?? []).some((r) => r.correct),
    hint: <>
      In the game you played <strong>{m.played}</strong>; best was <strong>{m.best}</strong>.{" "}
      <a href={`https://lichess.org/${m.gameId}#${m.ply + 1}`} target="_blank" rel="noreferrer">Open game ↗</a>
    </>,
  }));
}

export function Review() {
  const [tab, setTab] = useState<"puzzle" | "game">("puzzle");
  const data = useLiveQuery(async () => ({
    attempts: await db.attempts.toArray(),
    reviews: await db.reviews.toArray(),
    mistakes: await db.gameMistakes.toArray(),
  }), []);
  const [queue, setQueue] = useState<Item[]>();
  const [idx, setIdx] = useState(0);
  const [limit, setLimit] = useState(25);
  const byId = usePuzzleMap();

  const current = queue?.[idx];
  const onResult = useCallback(async (r: SolveResult) => {
    if (!current) return;
    await db.reviews.add({ id: newId(), kind: tab, refId: current.key, correct: r.correct, timeMs: r.timeMs, date: new Date().toISOString() });
  }, [current, tab]);

  if (!data || !byId) return <div className="screen"><p className="muted center">Loading…</p></div>;
  const items = tab === "puzzle" ? puzzleItems(data.attempts, data.reviews, byId) : gameItems(data.mistakes, data.reviews);
  const pending = items.filter((i) => !i.cleared);

  const start = (list: Item[], at = 0) => { setQueue(list); setIdx(at); };

  if (queue && current) {
    return (
      <div className="screen">
        <div className="train-head">
          <div className="train-meta">
            <button className="btn ghost" onClick={() => setQueue(undefined)}>← Back</button>
            <span className="muted small">{idx + 1}/{queue.length} · {current.title}</span>
          </div>
        </div>
        <PuzzleSolver key={current.key + idx} puzzle={current.puzzle} onResult={onResult} failHint={current.hint}
                      onNext={() => idx + 1 < queue.length ? setIdx(idx + 1) : setQueue(undefined)} />
      </div>
    );
  }

  return (
    <div className="screen">
      <div className="seg wide">
        <button className={tab === "puzzle" ? "on" : ""} onClick={() => setTab("puzzle")}>Missed puzzles</button>
        <button className={tab === "game" ? "on" : ""} onClick={() => setTab("game")}>Lichess games</button>
      </div>

      {tab === "game" && <GameSync />}

      <Card title={`${pending.length} to review`} right={pending.length > 0 &&
        <button className="btn primary" onClick={() => start(pending)}>Review all</button>}>
        {!items.length && <p className="muted small">
          {tab === "puzzle" ? "No missed puzzles yet. Nice!" : "No mistakes imported yet. Sync your analysed Lichess games above."}
        </p>}
        <ul className="list">
          {items.slice(0, limit).map((it, i) => (
            <li key={it.key} onClick={() => start(items, i)} className={it.cleared ? "cleared" : ""}>
              <div>
                <div className="list-title">{it.cleared && <span className="good">✓ </span>}{it.title}</div>
                <div className="list-sub">{it.sub}</div>
              </div>
              <span className="chev">›</span>
            </li>
          ))}
        </ul>
        {items.length > limit && <button className="btn ghost" onClick={() => setLimit(limit + 50)}>Show more ({items.length - limit})</button>}
      </Card>
      {tab === "puzzle" && data.reviews.some((r) => r.kind === "puzzle") && (
        <p className="small muted center">Review time counts toward your daily goal · avg {fmtSec(
          data.reviews.filter((r) => r.kind === "puzzle").reduce((s, r) => s + r.timeMs, 0) / data.reviews.filter((r) => r.kind === "puzzle").length)}</p>
      )}
    </div>
  );
}

function GameSync() {
  const { lichessUser } = useSettings();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string>();

  if (!lichessUser) return <Card><p className="muted small">Connect your Lichess account in <strong>Settings</strong> to import the mistakes from your games.</p></Card>;

  const sync = async () => {
    setBusy(true); setMsg(undefined);
    try {
      const r = await syncGames();
      setMsg(`Checked ${r.games} analysed games · ${r.mistakes} mistakes found`);
    } catch (e) { setMsg((e as Error).message); }
    setBusy(false);
  };

  return (
    <Card title={<>Lichess · {lichessUser}</>} right={<button className="btn" disabled={busy} onClick={sync}>{busy ? "Syncing…" : "Sync games"}</button>}>
      <p className="small muted">Imports your mistakes and blunders from your last 50 games with computer analysis.
        Request analysis on Lichess for games you want included.</p>
      {msg && <p className="small">{msg}</p>}
    </Card>
  );
}
