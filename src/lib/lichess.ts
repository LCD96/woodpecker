import { Chess, type Square } from "chess.js";
import { db, type GameMistake } from "./db";
import { getSettings, setSetting } from "./settings";

const LICHESS = "https://lichess.org";
const CLIENT_ID = "woodpecker-trainer";
const redirectUri = () => location.origin + location.pathname;

const b64url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

/** OAuth PKCE necesita crypto.subtle, que solo existe en contexto seguro (https o localhost) */
export const oauthAvailable = () => !!globalThis.crypto?.subtle;

export async function startLogin() {
  const verifier = b64url(crypto.getRandomValues(new Uint8Array(32)));
  const state = b64url(crypto.getRandomValues(new Uint8Array(16)));
  const challenge = b64url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))));
  sessionStorage.setItem("lichess-oauth", JSON.stringify({ verifier, state }));
  const params = new URLSearchParams({
    response_type: "code", client_id: CLIENT_ID, redirect_uri: redirectUri(),
    code_challenge_method: "S256", code_challenge: challenge, state,
  });
  location.href = `${LICHESS}/oauth?${params}`;
}

/** Al arrancar la app: si volvemos de Lichess con ?code=..., canjea el código por un token. */
export async function handleOAuthCallback() {
  const url = new URL(location.href);
  const code = url.searchParams.get("code"), state = url.searchParams.get("state");
  const error = url.searchParams.get("error");
  if (!code && !error) return;
  history.replaceState(null, "", redirectUri());
  const saved = JSON.parse(sessionStorage.getItem("lichess-oauth") ?? "null");
  sessionStorage.removeItem("lichess-oauth");
  if (error) throw new Error(`Lichess: ${url.searchParams.get("error_description") ?? error}`);
  if (!saved || saved.state !== state) throw new Error("Lichess login failed (state mismatch)");

  const res = await fetch(`${LICHESS}/api/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code", code: code!, code_verifier: saved.verifier,
      redirect_uri: redirectUri(), client_id: CLIENT_ID,
    }),
  });
  if (!res.ok) throw new Error(`Lichess token error ${res.status}`);
  const { access_token } = await res.json();
  const account = await fetch(`${LICHESS}/api/account`, { headers: { Authorization: `Bearer ${access_token}` } });
  if (!account.ok) throw new Error(`Lichess account error ${account.status}`);
  const { username } = await account.json();
  await setSetting("lichessToken", access_token);
  await setSetting("lichessUser", username);
}

/** Alternativa sin OAuth: las partidas públicas solo necesitan el nombre de usuario */
export async function connectByUsername(name: string) {
  const res = await fetch(`${LICHESS}/api/user/${encodeURIComponent(name.trim())}`);
  if (!res.ok) throw new Error(res.status === 404 ? "User not found" : `Lichess error ${res.status}`);
  const { username } = await res.json();
  await setSetting("lichessUser", username);
}

export async function disconnect() {
  const { lichessToken } = await getSettings();
  if (lichessToken) {
    await fetch(`${LICHESS}/api/token`, { method: "DELETE", headers: { Authorization: `Bearer ${lichessToken}` } }).catch(() => {});
  }
  await setSetting("lichessToken", undefined);
  await setSetting("lichessUser", undefined);
}

interface LichessGame {
  id: string;
  speed: string;
  createdAt: number;
  moves: string;
  players: Record<"white" | "black", { user?: { name: string; id: string } }>;
  opening?: { name: string };
  analysis?: { eval?: number; mate?: number; best?: string; judgment?: { name: string; comment?: string } }[];
}

/** Descarga las últimas partidas analizadas y guarda tus mistakes/blunders como puzzles. */
export async function syncGames(max = 50) {
  const { lichessUser, lichessToken } = await getSettings();
  if (!lichessUser) throw new Error("Connect your Lichess account first");
  const params = new URLSearchParams({ max: String(max), analysed: "true", evals: "true", opening: "true", moves: "true" });
  const res = await fetch(`${LICHESS}/api/games/user/${encodeURIComponent(lichessUser)}?${params}`, {
    headers: { Accept: "application/x-ndjson", ...(lichessToken ? { Authorization: `Bearer ${lichessToken}` } : {}) },
  });
  if (res.status === 404 && !lichessToken) {
    throw new Error("Lichess refused the anonymous export. Disconnect and use \"Log in with Lichess\" instead.");
  }
  if (!res.ok) throw new Error(res.status === 429 ? "Lichess rate limit, try again in a minute" : `Lichess error ${res.status}`);
  const games: LichessGame[] = (await res.text()).split("\n").filter(Boolean).map((l) => JSON.parse(l));

  const me = lichessUser.toLowerCase();
  // Una partida rara no debe estropear la sincronización entera
  const mistakes = games.flatMap((g) => {
    try { return extractMistakes(g, me); } catch (e) { console.warn(`Skipping game ${g.id}`, e); return []; }
  });
  await db.gameMistakes.bulkPut(mistakes);
  return { games: games.length, mistakes: mistakes.length };
}

/**
 * El análisis de Lichess escribe el enroque como "rey captura torre" (e1h1, e8a8),
 * pero chess.js y el resto de la app usan la casilla de destino del rey (e1g1, e8c8).
 */
export function normalizeCastling(fen: string, uci: string) {
  const from = uci.slice(0, 2), to = uci.slice(2, 4);
  const c = new Chess(fen);
  const piece = c.get(from as Square), target = c.get(to as Square);
  if (piece?.type !== "k" || target?.type !== "r" || target.color !== piece.color) return uci;
  return from + (to[0] > from[0] ? "g" : "c") + from[1];
}

function extractMistakes(g: LichessGame, me: string): GameMistake[] {
  if (!g.analysis) return [];
  const color = g.players.white.user?.id === me ? "white" : g.players.black.user?.id === me ? "black" : undefined;
  if (!color) return [];
  const opponent = g.players[color === "white" ? "black" : "white"].user?.name ?? "Anonymous";
  const sans = g.moves.split(" ").filter(Boolean);
  const chess = new Chess();
  const out: GameMistake[] = [];
  let fenBeforePrev = chess.fen();
  let prevUci = "";

  sans.forEach((san, ply) => {
    const a = g.analysis![ply];
    const mine = (ply % 2 === 0) === (color === "white");
    const fenBefore = chess.fen();
    const judgment = a?.judgment?.name;
    if (mine && ply > 0 && a?.best && (judgment === "Mistake" || judgment === "Blunder")) {
      const bestUci = normalizeCastling(fenBefore, a.best);
      const best = new Chess(fenBefore).move({ from: bestUci.slice(0, 2), to: bestUci.slice(2, 4), promotion: bestUci[4] });
      out.push({
        id: `${g.id}-${ply}`, gameId: g.id, ply,
        fen: fenBeforePrev, moves: [prevUci, bestUci],
        played: san, best: best.san, judgment,
        comment: a.judgment?.comment, color, opponent,
        speed: g.speed, opening: g.opening?.name,
        date: new Date(g.createdAt).toISOString(),
      });
    }
    const mv = chess.move(san);
    fenBeforePrev = fenBefore;
    prevUci = mv.from + mv.to + (mv.promotion ?? "");
  });
  return out;
}
