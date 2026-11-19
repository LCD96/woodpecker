import { useLiveQuery } from "dexie-react-hooks";
import { db } from "./db";

export interface Settings {
  dailyGoalMin: number;
  lichessUser?: string;
  lichessToken?: string;
}

const DEFAULTS: Settings = { dailyGoalMin: 30 };

export async function getSettings(): Promise<Settings> {
  const rows = await db.settings.toArray();
  return { ...DEFAULTS, ...Object.fromEntries(rows.map((r) => [r.key, r.value])) };
}

export async function setSetting<K extends keyof Settings>(key: K, value: Settings[K]) {
  if (value === undefined) await db.settings.delete(key);
  else await db.settings.put({ key, value });
}

export function useSettings(): Settings {
  return useLiveQuery(getSettings, [], DEFAULTS);
}
