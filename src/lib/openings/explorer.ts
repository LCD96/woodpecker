// Explorador de aperturas de Lichess. La base de partidas de Lichess exige iniciar sesión (token OAuth);
// la de maestros es pública.

import { getSettings } from "../settings";

export interface ExplorerMove {
  uci: string;
  san: string;
  white: number;
  draws: number;
  black: number;
  averageRating?: number;
}
export interface ExplorerResult {
  white: number;
  draws: number;
  black: number;
  moves: ExplorerMove[];
  opening?: { eco: string; name: string };
}

export const RATING_BUCKETS = [400, 1000, 1200, 1400, 1600, 1800, 2000, 2200, 2500];
export const SPEEDS = ["bullet", "blitz", "rapid", "classical", "correspondence"];

const cache = new Map<string, ExplorerResult>();

export class ExplorerAuthError extends Error {}

export async function explore(fen: string): Promise<ExplorerResult> {
  const s = await getSettings();
  const masters = s.explorerSource === "masters" || !s.lichessToken;
  const params = new URLSearchParams({ fen, moves: "20", topGames: "0", recentGames: "0" });
  if (!masters) {
    params.set("ratings", s.explorerRatings.join(","));
    params.set("speeds", s.explorerSpeeds.join(","));
  }
  const url = `https://explorer.lichess.ovh/${masters ? "masters" : "lichess"}?${params}`;
  const hit = cache.get(url);
  if (hit) return hit;
  const res = await fetch(url, { headers: !masters ? { Authorization: `Bearer ${s.lichessToken}` } : {} });
  if (res.status === 401) throw new ExplorerAuthError("Lichess rejected the login. Log in with Lichess again in Settings.");
  if (res.status === 429) throw new Error("Lichess rate limit: wait a minute");
  if (!res.ok) throw new Error(`Lichess explorer error ${res.status}`);
  const data: ExplorerResult = await res.json();
  cache.set(url, data);
  return data;
}

/** Qué base se consulta realmente (sin token solo hay maestros) */
export async function explorerLabel() {
  const s = await getSettings();
  if (s.explorerSource === "masters") return "Masters";
  if (!s.lichessToken) return "Masters (log in with Lichess for games at your level)";
  return `Lichess ${s.explorerRatings.join("/")} · ${s.explorerSpeeds.join(", ")}`;
}

export const total = (m: { white: number; draws: number; black: number }) => m.white + m.draws + m.black;

/** Puntuación (0..1) para el bando que juega la jugada */
export const scoreFor = (m: ExplorerMove, side: "white" | "black") => {
  const n = total(m);
  if (!n) return 0.5;
  return ((side === "white" ? m.white : m.black) + m.draws / 2) / n;
};
