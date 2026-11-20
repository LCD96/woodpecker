// Evaluaciones para el entrenador: caché local → evaluación en la nube de Lichess → Stockfish del navegador.
// Todas las puntuaciones se guardan desde el punto de vista de las blancas.

import { db, type CachedEval, type EvalLine } from "../db";
import { engine } from "../engine";
import { normalizeCastling } from "../lichess";
import { posKey } from "./chess";

const LOCAL_DEPTH = 18;

async function cloudEval(fen: string, multiPv: number): Promise<CachedEval | undefined> {
  const res = await fetch(`https://lichess.org/api/cloud-eval?${new URLSearchParams({ fen, multiPv: String(multiPv) })}`);
  if (!res.ok) return;                      // 404: posición sin evaluar en la nube
  const data: { depth: number; pvs: { moves: string; cp?: number; mate?: number }[] } = await res.json();
  return {
    fen: posKey(fen), depth: data.depth, source: "cloud",
    lines: data.pvs.map((p) => {
      const pv = p.moves.split(" ");
      pv[0] = normalizeCastling(fen, pv[0]);        // Lichess escribe el enroque como e1h1
      return { uci: pv[0], cp: p.cp, mate: p.mate, pv };
    }),
  };
}

async function localEval(fen: string, multiPv: number): Promise<CachedEval> {
  const lines = await engine.evaluate(fen, LOCAL_DEPTH, multiPv);
  return {
    fen: posKey(fen), depth: lines[0]?.depth ?? 0, source: "local",
    lines: lines.map((l) => ({ uci: l.pv[0], cp: l.cp, mate: l.mate, pv: l.pv })),
  };
}

/**
 * Mejores jugadas de la posición. Con multiPv > lo guardado, se vuelve a pedir.
 * Con `cloudOnly` no se usa Stockfish local (para evaluar muchas posiciones de golpe).
 */
export async function getEval(fen: string, multiPv = 3, cloudOnly = false): Promise<CachedEval | undefined> {
  const key = posKey(fen);
  const hit = await db.evals.get(key);
  if (hit && (hit.lines.length >= multiPv || hit.source === "local")) return hit;
  const cloud = await cloudEval(fen, multiPv).catch(() => undefined);
  if (!cloud && cloudOnly) return hit;
  const e = cloud ?? await localEval(fen, multiPv);
  if (!e.lines.length) return hit;
  // No guardar menos líneas de las que ya teníamos
  if (!hit || e.lines.length >= hit.lines.length) await db.evals.put(e);
  return e.lines.length >= (hit?.lines.length ?? 0) ? e : hit;
}

/** Probabilidad de ganar (0..1) para las blancas, la misma curva que usa Lichess */
export function winChance(l: Pick<EvalLine, "cp" | "mate">) {
  if (l.mate !== undefined) return l.mate > 0 ? 1 : 0;
  return 1 / (1 + Math.exp(-0.00368208 * (l.cp ?? 0)));
}

export const fmtLine = (l?: Pick<EvalLine, "cp" | "mate">) =>
  !l ? "…" : l.mate !== undefined ? `${l.mate > 0 ? "" : "-"}M${Math.abs(l.mate)}` : `${l.cp! > 0 ? "+" : ""}${(l.cp! / 100).toFixed(1)}`;
