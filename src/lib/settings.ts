import { useLiveQuery } from "dexie-react-hooks";
import { db } from "./db";
import { LOCAL_KEYS } from "./migrate";

export interface Settings {
  dailyGoalMin: number;
  lichessUser?: string;
  /** Solo en este dispositivo */
  lichessToken?: string;
  // Aperturas
  explorerSource: "lichess" | "masters";
  explorerRatings: number[];
  explorerSpeeds: string[];
  /** Pérdida de probabilidad de victoria (0..1) a partir de la cual una jugada fuera del repertorio es un error */
  openingTolerance: number;
  newCardsPerDay: number;
}

const DEFAULTS: Settings = {
  dailyGoalMin: 30,
  explorerSource: "lichess",
  explorerRatings: [1400, 1600, 1800],
  explorerSpeeds: ["blitz", "rapid", "classical"],
  openingTolerance: 0.05,
  newCardsPerDay: 10,
};

export async function getSettings(): Promise<Settings> {
  const rows = [...await db.settings.toArray(), ...await db.localSettings.where("key").anyOf([...LOCAL_KEYS]).toArray()];
  return { ...DEFAULTS, ...Object.fromEntries(rows.map((r) => [r.key.replace(/^#/, ""), r.value])) };
}

export async function setSetting<K extends keyof Settings>(key: K, value: Settings[K]) {
  // Los sincronizados llevan "#": clave privada por usuario en Dexie Cloud
  const [table, k] = LOCAL_KEYS.has(key) ? [db.localSettings, key] : [db.settings, `#${key}`];
  if (value === undefined) await table.delete(k);
  else await table.put({ key: k, value });
}

export function useSettings(): Settings {
  return useLiveQuery(getSettings, [], DEFAULTS);
}
