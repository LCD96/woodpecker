// Jugadas extra en el entrenamiento: de vez en cuando el rival se sale del repertorio con una jugada
// habitual a tu nivel (o que le da buen resultado) que aún no has preparado, para ver si sabes responder.

import { play, posKey, turnOf } from "./chess";
import { explore, levelSource, total } from "./explorer";
import type { Graph } from "./repertoire";

export interface Bonus { uci: string; san: string; fen: string; reason: string; }

/** Probabilidad de intentarlo en cada posición del rival (una sola tirada por posición y sesión) */
export const BONUS_CHANCE = 0.3;
const COMMON = 0.1, DANGER_MIN = 0.03, DANGER_GAMES = 30, DANGER_EDGE = 0.07;

export async function pickBonus(g: Graph, fen: string): Promise<Bonus | undefined> {
  const source = await levelSource();
  const ex = await explore(fen, source).catch(() => undefined);
  const n = ex ? total(ex) : 0;
  if (!ex || !n) return;
  const opp = turnOf(fen);
  const score = (r: { white: number; draws: number; black: number }) =>
    ((opp === "white" ? r.white : r.black) + r.draws / 2) / (total(r) || 1);
  const avg = score(ex);
  const prepared = new Set((g.byFrom.get(posKey(fen)) ?? []).map((m) => m.uci));
  const known = new Set([...g.moves.map((m) => m.to), ...g.byFrom.keys()]);
  const who = source === "lichess" ? "at your level" : "by masters";

  const cands = ex.moves.flatMap((m) => {
    const after = play(fen, m.uci);
    // Si transpone a tu repertorio ya lo sabes; si no, solo lo habitual o lo que le sale bien al rival
    if (!after || prepared.has(m.uci) || known.has(posKey(after.fen))) return [];
    const share = total(m) / n, s = score(m);
    const common = share >= COMMON;
    const danger = share >= DANGER_MIN && total(m) >= DANGER_GAMES && s - avg >= DANGER_EDGE;
    if (!common && !danger) return [];
    const reason = danger
      ? `Your opponents score ${Math.round(s * 100)}% with it ${who}`
      : `Played in ${Math.round(share * 100)}% of games ${who}`;
    return [{ uci: after.uci, san: after.san, fen: after.fen, reason, weight: share + (danger ? 0.1 : 0) }];
  });
  cands.sort((a, b) => b.weight - a.weight);
  const best = cands[0];
  return best && { uci: best.uci, san: best.san, fen: best.fen, reason: best.reason };
}
