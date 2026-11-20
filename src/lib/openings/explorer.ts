// Explorador de aperturas de Lichess. La base de partidas de Lichess ("tu nivel") exige iniciar sesión
// (token OAuth); la de maestros es pública.

import { normalizeCastling } from "../lichess";
import { getSettings } from "../settings";

export interface ExplorerMove {
  uci: string;
  san: string;
  white: number;
  draws: number;
  black: number;
  averageRating?: number;
}
export interface ExplorerGame { id: string; uci?: string; }
export interface ExplorerResult {
  white: number;
  draws: number;
  black: number;
  moves: ExplorerMove[];
  opening?: { eco: string; name: string };
  topGames?: ExplorerGame[];
  recentGames?: ExplorerGame[];
}

export type Source = "lichess" | "masters";

export const RATING_BUCKETS = [400, 1000, 1200, 1400, 1600, 1800, 2000, 2200, 2500];
export const SPEEDS = ["bullet", "blitz", "rapid", "classical", "correspondence"];

const cache = new Map<string, Promise<ExplorerResult>>();

export class ExplorerAuthError extends Error {}

/** `games`: pide también partidas de ejemplo (para los planes) */
export async function explore(fen: string, source: Source, games = false): Promise<ExplorerResult> {
  const s = await getSettings();
  if (source === "lichess" && !s.lichessToken) throw new ExplorerAuthError("Log in with Lichess (Settings) to see games at your level");
  const params = new URLSearchParams({ fen, moves: "30", topGames: games ? "15" : "0", recentGames: games && source === "lichess" ? "8" : "0" });
  if (source === "lichess") {
    params.set("ratings", s.explorerRatings.join(","));
    params.set("speeds", s.explorerSpeeds.join(","));
  }
  const url = `https://explorer.lichess.ovh/${source}?${params}`;
  // Las peticiones en vuelo también se comparten: varias partes de la pantalla piden la misma posición
  const hit = cache.get(url);
  if (hit) return hit;
  const p = (async () => {
    const res = await fetch(url, { headers: source === "lichess" ? { Authorization: `Bearer ${s.lichessToken}` } : {} });
    if (res.status === 401) throw new ExplorerAuthError("Lichess rejected the login. Log in with Lichess again in Settings.");
    if (res.status === 429) throw new Error("Lichess rate limit: wait a minute");
    if (!res.ok) throw new Error(`Lichess explorer error ${res.status}`);
    const data: ExplorerResult = await res.json();
    // Lichess escribe el enroque como "rey captura torre" (e1h1); el resto de la app usa e1g1
    for (const m of data.moves) m.uci = normalizeCastling(fen, m.uci);
    return data;
  })();
  cache.set(url, p);
  p.catch(() => cache.delete(url));
  return p;
}

/** Base que representa "tu nivel": la de Lichess si hay sesión; si no, maestros */
export async function levelSource(): Promise<Source> {
  return (await getSettings()).lichessToken ? "lichess" : "masters";
}

export async function levelLabel() {
  const s = await getSettings();
  if (!s.lichessToken) return "Masters (log in with Lichess in Settings for games at your level)";
  return `Lichess ${s.explorerRatings[0]}–${s.explorerRatings.at(-1)! + 199} · ${s.explorerSpeeds.join(", ")}`;
}

export const total = (m: { white: number; draws: number; black: number }) => m.white + m.draws + m.black;

/** Puntuación (0..1) para el bando que juega la jugada */
export const scoreFor = (m: ExplorerMove, side: "white" | "black") => {
  const n = total(m);
  if (!n) return 0.5;
  return ((side === "white" ? m.white : m.black) + m.draws / 2) / n;
};

/** Proporción (0..1) de partidas de la posición en las que se jugó `uci` */
export const shareOf = (r: ExplorerResult | undefined, uci: string) => {
  const n = r ? total(r) : 0;
  const m = r?.moves.find((x) => x.uci === uci);
  return n && m ? total(m) / n : 0;
};
