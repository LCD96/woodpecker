// Informe de una posición para el editor: estadísticas a tu nivel y de maestros, evaluación de cada jugada,
// errores típicos, transposiciones y cada cuántas partidas te encontrarás la posición.

import { useEffect, useState } from "react";
import type { CachedEval, EvalLine } from "../db";
import { useSettings } from "../settings";
import { play, posKey, turnOf } from "./chess";
import { getEval, winChance } from "./evals";
import { explore, levelSource, shareOf, total, type ExplorerResult, type Source } from "./explorer";
import type { Graph } from "./repertoire";

export type Label = "?!" | "?" | "??";

export interface MoveRow {
  uci: string;
  san: string;
  /** Partidas y resultados a tu nivel (o de maestros si no hay sesión de Lichess) */
  games: number;
  white: number;
  draws: number;
  black: number;
  levelShare?: number;
  mastersShare?: number;
  eval?: Pick<EvalLine, "cp" | "mate">;
  /** Probabilidad de victoria perdida frente a la mejor jugada (0..1), para quien mueve */
  loss?: number;
  label?: Label;
  commonMistake: boolean;
  engineRank?: number;
  inRep: boolean;
  transposes: boolean;
  /** Tras esta jugada llegas a la posición 1 de cada N partidas con tu color */
  seenEvery?: number;
}

export interface Report {
  fen: string;
  source: Source;
  level?: ExplorerResult;
  masters?: ExplorerResult;
  levelError?: string;
  eval?: CachedEval;
  evalDone: boolean;
  /** Probabilidad (0..1) de llegar a la posición actual en una partida con tu color */
  reach?: number;
  rows: MoveRow[];
}

export const labelFor = (loss?: number): Label | undefined =>
  loss === undefined ? undefined : loss >= 0.15 ? "??" : loss >= 0.1 ? "?" : loss >= 0.05 ? "?!" : undefined;

/** Jugadas del camino: fen antes de cada jugada + uci */
export interface PathStep { before: string; uci: string; }

export function usePositionReport(fen: string, path: PathStep[], graph: Graph | undefined): Report | undefined {
  const s = useSettings();
  const [data, setData] = useState<Omit<Report, "rows">>();
  const [childEvals, setChildEvals] = useState<{ fen: string; evals: Map<string, Pick<EvalLine, "cp" | "mate">> }>();
  const settingsKey = `${s.explorerRatings}|${s.explorerSpeeds}|${!!s.lichessToken}`;
  const pathKey = path.map((p) => p.uci).join(" ");
  const color = graph?.rep.color;

  // Explorador (tu nivel + maestros), evaluación y probabilidad de llegar aquí
  useEffect(() => {
    let cancelled = false;
    const t = setTimeout(async () => {
      const source = await levelSource();
      const set = (patch: Partial<Omit<Report, "rows">>) => !cancelled && setData((d) => ({
        ...(d?.fen === fen ? d : { fen, source, evalDone: false }), ...patch,
      }));
      set({ source });
      explore(fen, "masters").then((masters) => set({ masters }), () => {});
      if (source === "lichess") explore(fen, "lichess").then((level) => set({ level }), (e: Error) => set({ levelError: e.message }));
      getEval(fen, 5).then((e) => set({ eval: e, evalDone: true }), () => set({ evalDone: true }));
      if (color) {
        // Solo cuentan las jugadas del rival: las tuyas las eliges tú
        try {
          let p = 1;
          for (const st of path) {
            if (turnOf(st.before) === color) continue;
            p *= shareOf(await explore(st.before, source), st.uci);
          }
          set({ reach: p });
        } catch { /* sin datos: no se muestra */ }
      }
    }, 250);                                // al pasar rápido por las jugadas no se lanza una petición por cada una
    return () => { cancelled = true; clearTimeout(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fen, pathKey, settingsKey, color]);

  // Evaluación de las jugadas habituales que el motor no ha incluido entre sus mejores
  const level = data?.fen === fen ? data.level ?? (data.source === "masters" ? data.masters : undefined) : undefined;
  const evalLines = data?.fen === fen ? data.eval?.lines : undefined;
  useEffect(() => {
    if (!level || !data?.evalDone) return;
    let cancelled = false;
    const known = new Set(evalLines?.map((l) => l.uci));
    const n = total(level);
    const todo = level.moves.filter((m) => !known.has(m.uci) && n && total(m) / n >= 0.01).slice(0, 8);
    (async () => {
      const evals = new Map<string, Pick<EvalLine, "cp" | "mate">>();
      for (const m of todo) {
        const after = play(fen, m.uci);
        if (!after || cancelled) continue;
        const e = await getEval(after.fen, 1, true).catch(() => undefined);
        if (cancelled) return;
        if (e?.lines[0]) { evals.set(m.uci, e.lines[0]); setChildEvals({ fen, evals: new Map(evals) }); }
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [level, data?.evalDone, fen]);

  if (!data || data.fen !== fen || !graph) return;
  return { ...data, rows: buildRows(fen, data, childEvals?.fen === fen ? childEvals.evals : new Map(), graph) };
}

function buildRows(fen: string, d: Omit<Report, "rows">, childEvals: Map<string, Pick<EvalLine, "cp" | "mate">>, g: Graph): MoveRow[] {
  const level = d.source === "lichess" ? d.level : d.masters;
  const mover = turnOf(fen);
  const wc = (l: Pick<EvalLine, "cp" | "mate">) => (mover === "white" ? winChance(l) : 1 - winChance(l));
  const lines = d.eval?.lines ?? [];
  const best = lines[0];
  const key = posKey(fen);
  const repHere = new Set((g.byFrom.get(key) ?? []).map((m) => m.uci));
  const repPositions = new Set([...g.moves.map((m) => m.to), ...g.byFrom.keys()]);
  const opponentTurn = mover !== g.rep.color;

  const ucis = [...new Set([...(level?.moves ?? []).map((m) => m.uci), ...(d.masters?.moves ?? []).map((m) => m.uci), ...lines.map((l) => l.uci)])];
  const rows = ucis.flatMap((uci): MoveRow[] => {
    const after = play(fen, uci);
    if (!after) return [];
    const lm = level?.moves.find((m) => m.uci === uci);
    const mm = d.masters?.moves.find((m) => m.uci === uci);
    const rank = lines.findIndex((l) => l.uci === uci);
    const ev = rank >= 0 ? lines[rank] : childEvals.get(uci);
    const loss = ev && best ? Math.max(0, wc(best) - wc(ev)) : undefined;
    const label = labelFor(loss);
    const levelShare = level && total(level) ? (lm ? total(lm) / total(level) : 0) : undefined;
    const r = lm ?? mm;
    return [{
      uci, san: after.san,
      games: lm ? total(lm) : 0, white: r?.white ?? 0, draws: r?.draws ?? 0, black: r?.black ?? 0,
      levelShare,
      mastersShare: d.masters && total(d.masters) ? (mm ? total(mm) / total(d.masters) : 0) : undefined,
      eval: ev, loss, label,
      commonMistake: opponentTurn && (label === "?" || label === "??") && (levelShare ?? 0) >= 0.03,
      engineRank: rank >= 0 ? rank : undefined,
      inRep: repHere.has(uci),
      transposes: !repHere.has(uci) && repPositions.has(posKey(after.fen)),
      seenEvery: opponentTurn && d.reach && levelShare ? 1 / (d.reach * levelShare) : undefined,
    }];
  });
  // Primero lo más jugado a tu nivel; luego maestros; las del motor que nadie juega, al final
  return rows.sort((a, b) => b.games - a.games || (b.mastersShare ?? 0) - (a.mastersShare ?? 0) || (a.engineRank ?? 9) - (b.engineRank ?? 9));
}
