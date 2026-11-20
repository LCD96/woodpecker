import type { Attempt, Cycle, Puzzle, Review } from "./db";

const mediana = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : 0; };
const media = (xs: number[]) => xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
const IGNORAR = new Set(["short", "long", "veryLong", "oneMove", "crushing", "advantage", "mate", "master", "masterVsMaster",
  "middlegame", "opening", "equality"]);

export function statsPorTema(attempts: Attempt[], puzzles: Puzzle[], minIntentos = 10) {
  const byId = new Map(puzzles.map((p) => [p.id, p]));
  const medGlobal = mediana(attempts.map((a) => a.timeMs));
  const grupos = new Map<string, Attempt[]>();
  for (const a of attempts) {
    for (const t of byId.get(a.puzzleId)?.themes ?? []) {
      if (!IGNORAR.has(t)) grupos.set(t, [...(grupos.get(t) ?? []), a]);
    }
  }
  return [...grupos].filter(([, as]) => as.length >= minIntentos).map(([tema, as]) => ({
    tema,
    intentos: as.length,
    aciertos: as.filter((a) => a.correct).length / as.length,
    tiempoRelativo: mediana(as.map((a) => a.timeMs)) / medGlobal,   // >1 = dudas más que tu media
  })).sort((a, b) => a.aciertos - b.aciertos);
}

/** Fallados en más de un ciclo: tus puntos ciegos */
export function problematicos(attempts: Attempt[]) {
  const ciclosFallados = new Map<string, Set<number>>();
  for (const a of attempts) if (!a.correct) {
    ciclosFallados.set(a.puzzleId, (ciclosFallados.get(a.puzzleId) ?? new Set()).add(a.cycle));
  }
  return [...ciclosFallados].filter(([, s]) => s.size > 1).map(([id]) => id);
}

// ---------- Resumen, días y ciclos ----------

export interface Summary { count: number; accuracy: number; avgTimeMs: number; }

export function summarize(attempts: Attempt[]): Summary {
  return {
    count: attempts.length,
    accuracy: attempts.length ? attempts.filter((a) => a.correct).length / attempts.length : 0,
    avgTimeMs: media(attempts.map((a) => a.timeMs)),
  };
}

/** Fecha local YYYY-MM-DD */
export const dayKey = (d: string | Date) => {
  const x = new Date(d);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`;
};

export function lastDays(n: number) {
  return Array.from({ length: n }, (_, i) => {
    const d = new Date(); d.setDate(d.getDate() - (n - 1 - i));
    return { key: dayKey(d), label: d.toLocaleDateString("en-US", { weekday: "short" }), date: d };
  });
}

export interface DayStats extends Summary { key: string; label: string; minutes: number; }

/** Minutos = tiempo pensando en puzzles del ciclo + repasos de errores */
export function daily(attempts: Attempt[], reviews: Review[], n = 7): DayStats[] {
  const days = lastDays(n);
  const att = new Map<string, Attempt[]>(), ms = new Map<string, number>();
  for (const a of attempts) {
    const k = dayKey(a.date);
    att.set(k, [...(att.get(k) ?? []), a]);
    ms.set(k, (ms.get(k) ?? 0) + a.timeMs);
  }
  for (const r of reviews) { const k = dayKey(r.date); ms.set(k, (ms.get(k) ?? 0) + r.timeMs); }
  return days.map((d) => ({ key: d.key, label: d.label, ...summarize(att.get(d.key) ?? []), minutes: (ms.get(d.key) ?? 0) / 60000 }));
}

export function minutesToday(attempts: Attempt[], reviews: Review[]) {
  const today = dayKey(new Date());
  return [...attempts, ...reviews].filter((x) => dayKey(x.date) === today).reduce((s, x) => s + x.timeMs, 0) / 60000;
}

/** Minutos de hoy por actividad y puzzles del ciclo resueltos hoy */
export function todayBreakdown(attempts: Attempt[], reviews: Review[]) {
  const today = dayKey(new Date());
  const a = attempts.filter((x) => dayKey(x.date) === today);
  const r = reviews.filter((x) => dayKey(x.date) === today);
  const min = (xs: { timeMs: number }[]) => xs.reduce((s, x) => s + x.timeMs, 0) / 60000;
  return {
    total: min(a) + min(r),
    puzzles: min(a), puzzlesCount: a.length,
    review: min(r.filter((x) => x.kind !== "opening")),
    openings: min(r.filter((x) => x.kind === "opening")),
  };
}

/** Días seguidos (hasta hoy, o ayer si hoy aún no se ha cumplido) alcanzando el objetivo */
export function goalStreak(attempts: Attempt[], reviews: Review[], goalMin: number) {
  const ms = new Map<string, number>();
  for (const x of [...attempts, ...reviews]) { const k = dayKey(x.date); ms.set(k, (ms.get(k) ?? 0) + x.timeMs); }
  const met = (d: Date) => (ms.get(dayKey(d)) ?? 0) / 60000 >= goalMin;
  const d = new Date();
  if (!met(d)) d.setDate(d.getDate() - 1);
  let streak = 0;
  while (met(d)) { streak++; d.setDate(d.getDate() - 1); }
  return streak;
}

/**
 * Eficiencia frente al ciclo 1 (= 100): media del ratio de acierto y del ratio de velocidad.
 * 120 = un 20 % mejor combinando precisión y rapidez.
 */
export function efficiency(s: Summary, base: Summary) {
  if (!s.count || !base.count || !base.accuracy || !s.avgTimeMs) return undefined;
  return ((s.accuracy / base.accuracy) + (base.avgTimeMs / s.avgTimeMs)) / 2 * 100;
}

export function cycleStats(attempts: Attempt[], cycles: Cycle[]) {
  const base = summarize(attempts.filter((a) => a.cycle === 1));
  return cycles.map((c) => {
    const as = attempts.filter((a) => a.cycle === c.n);
    const s = summarize(as);
    const last = as.length ? Math.max(...as.map((a) => +new Date(a.date))) : Date.now();
    const daysTaken = ((c.end ? +new Date(c.end) : last) - +new Date(c.start)) / 86400000;
    return { n: c.n, ...s, total: c.order.length, targetDays: c.targetDays, daysTaken, done: !!c.end, efficiency: efficiency(s, base) };
  });
}

// ---------- Temas ----------

/** 7 familias tácticas para el heptágono */
export const CATEGORIES: { name: string; themes: string[] }[] = [
  { name: "Double attacks", themes: ["fork", "doubleCheck", "discoveredAttack"] },
  { name: "Pins & skewers", themes: ["pin", "skewer", "xRayAttack"] },
  { name: "Defender removal", themes: ["deflection", "capturingDefender", "attraction", "overloading", "interference", "clearance"] },
  { name: "Sacrifice & quiet", themes: ["sacrifice", "quietMove", "intermezzo", "zugzwang", "defensiveMove"] },
  { name: "Mating attack", themes: ["backRankMate", "mateIn1", "mateIn2", "mateIn3", "mateIn4", "mateIn5", "smotheredMate",
    "anastasiaMate", "arabianMate", "bodenMate", "hookMate", "doubleBishopMate", "dovetailMate", "kingsideAttack",
    "queensideAttack", "attackingF2F7", "exposedKing"] },
  { name: "Loose pieces", themes: ["hangingPiece", "trappedPiece"] },
  { name: "Endgame", themes: ["endgame", "rookEndgame", "pawnEndgame", "queenEndgame", "bishopEndgame", "knightEndgame",
    "queenRookEndgame", "advancedPawn", "promotion", "underPromotion"] },
];

export interface ThemeAcc { name: string; attempts: number; accuracy: number; }

export function themeAccuracy(attempts: Attempt[], byId: Map<string, Puzzle>): ThemeAcc[] {
  const g = new Map<string, { n: number; ok: number }>();
  for (const a of attempts) for (const t of byId.get(a.puzzleId)?.themes ?? []) {
    if (IGNORAR.has(t)) continue;
    const x = g.get(t) ?? { n: 0, ok: 0 };
    x.n++; if (a.correct) x.ok++;
    g.set(t, x);
  }
  return [...g].map(([name, x]) => ({ name, attempts: x.n, accuracy: x.ok / x.n })).sort((a, b) => b.attempts - a.attempts);
}

/** Cada intento cuenta una vez por categoría aunque tenga varios temas de la misma familia */
export function categoryAccuracy(attempts: Attempt[], byId: Map<string, Puzzle>): ThemeAcc[] {
  return CATEGORIES.map((c) => {
    const set = new Set(c.themes);
    const as = attempts.filter((a) => byId.get(a.puzzleId)?.themes.some((t) => set.has(t)));
    return { name: c.name, attempts: as.length, accuracy: as.length ? as.filter((a) => a.correct).length / as.length : 0 };
  });
}

export function ratingBuckets(attempts: Attempt[], byId: Map<string, Puzzle>, size = 100) {
  const g = new Map<number, { n: number; ok: number }>();
  for (const a of attempts) {
    const r = byId.get(a.puzzleId)?.rating;
    if (r === undefined) continue;
    const b = Math.floor(r / size) * size;
    const x = g.get(b) ?? { n: 0, ok: 0 };
    x.n++; if (a.correct) x.ok++;
    g.set(b, x);
  }
  return [...g].sort(([a], [b]) => a - b).map(([from, x]) => ({ label: `${from}`, attempts: x.n, accuracy: x.ok / x.n }));
}

/** Rango de acierto recomendado para el método Woodpecker */
export function calibration(accuracy: number, count: number) {
  if (count < 20) return { level: "info", text: "Solve at least 20 puzzles for a reliable read." } as const;
  if (accuracy < 0.7) return { level: "warn", text: "Below 70% — this set is likely too hard. Consider lower-rated puzzles." } as const;
  if (accuracy > 0.92) return { level: "warn", text: "Above 92% — this set may be too easy. Consider higher-rated puzzles." } as const;
  return { level: "good", text: "In the 70–92% sweet spot — your puzzle rating is well calibrated." } as const;
}

export const fmtSec = (ms: number) => ms ? `${(ms / 1000).toFixed(1)}s` : "—";
export const fmtPct = (x: number) => `${Math.round(x * 100)}%`;

const THEME_NAMES: Record<string, string> = {
  discoveredAttack: "Discovery", capturingDefender: "Capt. defender", hangingPiece: "Hanging piece",
  trappedPiece: "Trapped piece", backRankMate: "Back rank", quietMove: "Quiet move", xRayAttack: "X-ray",
  advancedPawn: "Adv. pawn", kingsideAttack: "Kingside att.", exposedKing: "Exposed king", defensiveMove: "Defensive",
};
export const prettyTheme = (t: string) => THEME_NAMES[t] ?? t.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase());
