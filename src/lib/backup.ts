import { db, type Attempt, type Cycle, type GameMistake, type Puzzle, type Review, type Setting } from "./db";

navigator.storage?.persist?.();

export interface Backup {
  version: 1 | 2 | 3;
  exportedAt: string;
  attempts: Attempt[];
  cycles: Cycle[];
  reviews?: Review[];
  gameMistakes?: GameMistake[];
  settings?: Setting[];
  puzzles?: Puzzle[];          // v3: el set de puzzles, para que el ciclo sea el mismo en el otro dispositivo
}

export interface BackupSummary {
  cycle?: number;
  cycleDone: number;
  cycleTotal: number;
  attempts: number;
  reviews: number;
  gameMistakes: number;
  puzzles?: number;
  lastActivity?: string;
}

export function summarizeBackup(b: Omit<Backup, "version" | "exportedAt">): BackupSummary {
  const cur = [...b.cycles].sort((x, y) => x.n - y.n).at(-1);
  const dates = [...b.attempts, ...(b.reviews ?? [])].map((x) => x.date).sort();
  return {
    cycle: cur?.n,
    cycleDone: cur ? new Set(b.attempts.filter((a) => a.cycle === cur.n).map((a) => a.puzzleId)).size : 0,
    cycleTotal: cur?.order.length ?? 0,
    attempts: b.attempts.length,
    reviews: b.reviews?.length ?? 0,
    gameMistakes: b.gameMistakes?.length ?? 0,
    puzzles: b.puzzles?.length,
    lastActivity: dates.at(-1),
  };
}

export async function localBackup(): Promise<Backup> {
  return {
    version: 3,
    exportedAt: new Date().toISOString(),
    attempts: await db.attempts.toArray(),
    cycles: await db.cycles.toArray(),
    reviews: await db.reviews.toArray(),
    gameMistakes: await db.gameMistakes.toArray(),
    // El token de Lichess no se exporta
    settings: (await db.settings.toArray()).filter((s) => s.key !== "lichessToken"),
    puzzles: await db.puzzles.toArray(),
  };
}

export const canShareFiles = () =>
  !!navigator.canShare?.({ files: [new File(["{}"], "x.json", { type: "application/json" })] });

/** "share": menú de compartir del sistema (Drive, correo…); "download": guarda el fichero */
export async function exportData(mode: "download" | "share" = "download") {
  const data = await localBackup();
  const file = new File([JSON.stringify(data)], `woodpecker-${data.exportedAt.slice(0, 16).replace(":", "")}.json`,
                        { type: "application/json" });

  // En el móvil, el menú de compartir permite guardarlo en Archivos, Drive, enviarlo por correo...
  if (mode === "share") {
    await navigator.share({ files: [file], title: "Woodpecker backup" });
  } else {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(file);
    a.download = file.name;
    a.click();
  }
}

export async function readBackup(file: File): Promise<Backup> {
  let data: Backup;
  try { data = JSON.parse(await file.text()); } catch { throw new Error("This file isn't a Woodpecker backup"); }
  if (![1, 2, 3].includes(data?.version) || !Array.isArray(data.attempts) || !Array.isArray(data.cycles)) {
    throw new Error("Unsupported or damaged backup file");
  }
  // Todos los puzzles del ciclo deben existir en el set que quedará tras importar
  if (data.puzzles) {
    const ids = new Set(data.puzzles.map((p) => p.id));
    if (data.cycles.some((c) => c.order.some((id) => !ids.has(id)))) throw new Error("Backup is missing puzzles from its cycles");
  }
  return data;
}

/** Sustituye todos los datos de este dispositivo por los de la copia */
export async function restoreBackup(data: Backup) {
  await db.transaction("rw", [db.attempts, db.cycles, db.reviews, db.gameMistakes, db.settings, db.puzzles], async () => {
    const localUser = (await db.settings.get("lichessUser"))?.value;
    await db.attempts.clear(); await db.cycles.clear();
    await db.attempts.bulkAdd(data.attempts); await db.cycles.bulkAdd(data.cycles);
    if (data.version >= 2) {
      await db.reviews.clear(); await db.gameMistakes.clear();
      await db.reviews.bulkAdd(data.reviews ?? []); await db.gameMistakes.bulkAdd(data.gameMistakes ?? []);
      await db.settings.where("key").notEqual("lichessToken").delete();
      await db.settings.bulkPut(data.settings ?? []);
      // El token local solo sirve si la copia es de la misma cuenta de Lichess
      const user = data.settings?.find((s) => s.key === "lichessUser")?.value;
      if (!user || user !== localUser) await db.settings.delete("lichessToken");
    }
    if (data.puzzles?.length) { await db.puzzles.clear(); await db.puzzles.bulkAdd(data.puzzles); }
  });
}
