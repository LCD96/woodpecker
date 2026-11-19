import { db, type Cycle } from "./db";

export const PLAZOS = [28, 14, 7, 4, 2, 1];   // días por ciclo

const barajar = <T,>(a: T[]) => { a = [...a]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

export async function currentCycle(): Promise<Cycle | undefined> {
  return db.cycles.orderBy("n").last();
}

export async function startNextCycle() {
  const last = await currentCycle();
  const n = (last?.n ?? 0) + 1;
  await db.cycles.put({
    n,
    start: new Date().toISOString(),
    targetDays: PLAZOS[Math.min(n - 1, PLAZOS.length - 1)],
    order: barajar((await db.puzzles.toCollection().primaryKeys()) as string[]),
  });
}

export async function nextPuzzleId(c: Cycle) {
  const hechos = new Set((await db.attempts.where("cycle").equals(c.n).toArray()).map((a) => a.puzzleId));
  return c.order.find((id) => !hechos.has(id));          // undefined = ciclo terminado
}

export async function ritmo(c: Cycle) {
  const hechos = await db.attempts.where("cycle").equals(c.n).count();
  const restantes = c.order.length - hechos;
  const fin = new Date(c.start).getTime() + c.targetDays * 86400000;
  const diasRestantes = Math.max(1, Math.ceil((fin - Date.now()) / 86400000));
  return { hechos, restantes, diasRestantes, porDia: Math.ceil(restantes / diasRestantes) };
}