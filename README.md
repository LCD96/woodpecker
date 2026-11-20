# Woodpecker

A mobile-first trainer for the **Woodpecker Method**: solve the same set of tactics puzzles over and over in shrinking cycles (28 → 14 → 7 → 4 → 2 → 1 days) until the patterns become automatic. It also trains **opening repertoires** with spaced repetition.

It runs in your browser and installs as an app (PWA). Progress is stored on your device and, if you sign in, synced across devices with [Dexie Cloud](https://dexie.org/cloud/). Backup files work too.

## Features

- **Train:** start a cycle when you're ready (the clock starts then, so you can rest between cycles) and work through it on a Lichess-style board (brown board, cburnett pieces). A timer runs on every puzzle, and the header shows your daily pace and progress toward your daily goal.
- **After each puzzle:** step through the moves, try your own variations, see the solution after a miss, and **Analyse** with Stockfish 18. The engine runs on your device and works offline after first use. You can also open the position on Lichess.
- **Stats:**
  - overall and per-cycle accuracy, with a calibration hint telling you whether your puzzle rating is too easy or too hard
  - a skill map (radar chart) by tactical category or by individual theme, compared against cycle 1
  - last-7-days charts for time spent, puzzles solved, average time, accuracy and efficiency
  - a cycle history table
- **Efficiency:** a single score combining accuracy and speed, relative to cycle 1 (= 100):
  `((accuracy ÷ cycle-1 accuracy) + (cycle-1 avg time ÷ avg time)) ÷ 2 × 100`
- **Review:**
  - replay every puzzle you missed, with blind spots (missed in more than one cycle) flagged
  - import your mistakes and blunders from analysed **Lichess** games as puzzles
- **Openings:**
  - build White and Black repertoires on the board, with the **Lichess opening explorer** (games at the ratings and time controls you choose; needs a Lichess login, otherwise master games) and engine lines (Lichess cloud evaluation, or Stockfish in the browser)
  - write notes on any move; import PGN files or Lichess studies (variations and comments included) and export your repertoire as PGN
  - positions are stored by FEN, so transpositions share their moves and notes
  - **train** with spaced repetition (FSRS): the app plays the line from the start and asks you only the positions that are due, plus a daily quota of new ones
  - a move outside your repertoire that keeps the evaluation (within the tolerance set in Settings) is accepted with "try again"; a move that drops it is marked wrong, the board plays the opponent's punishing line, and you then play your repertoire move
  - hints (highlight the piece, then the arrow) and your notes are available while you think
- **Daily goal:** set your minutes per day (puzzles, reviews and opening practice), track progress and keep a streak.
- **Sync:** sign in with your email (one-time code) to sync everything across devices, or export and import a backup file.

## Development

```bash
npm install
npm run dev          # http://localhost:5173
npm run dev -- --host  # also reachable from your phone on the same network
npm run build
npm run lint
```

Lichess login uses OAuth (PKCE) and needs HTTPS or `localhost`. When you open the app over plain `http://` from another device, only the username connection is available. Lichess currently requires the login to download your game list.

### Regenerating the puzzle set

The bundled set (`src/data/puzzles.json`, 500 puzzles rated 1600–2000, spread across 17 tactical motifs) comes from the [Lichess puzzle database](https://database.lichess.org/#puzzles) (CC0). To build a new set, download `lichess_db_puzzle.csv.zst` into `data/` and run:

```bash
node scripts/build-puzzles.mjs
```

Devices that already have a puzzle set keep it, because the set is part of each device's saved progress. A new set only applies to fresh installs, or after importing a backup that contains it.

### Cloud sync (Dexie Cloud)

Without `VITE_DEXIE_CLOUD_URL` the app is local-only. To turn sync on:

```bash
npx dexie-cloud create                                  # asks for your email and a one-time code; writes dexie-cloud.json + dexie-cloud.key (gitignored)
npx dexie-cloud whitelist https://<user>.github.io      # the Pages origin (no path)
npx dexie-cloud whitelist http://localhost:5173         # for development
gh variable set DEXIE_CLOUD_URL --body https://<id>.dexie.cloud
```

For local development put `VITE_DEXIE_CLOUD_URL=https://<id>.dexie.cloud` in `.env.local`. On the free plan, users who sign in start on a 30-active-day evaluation licence; upgrade your own user to production (3 free seats) in [Dexie Cloud Manager](https://manager.dexie.cloud) so syncing doesn't stop.

Data model notes: synced tables use string keys only (random ids, or `#`-prefixed ids that are private per user, like `#c1` for cycle 1 and `#dailyGoalMin`). The puzzle set, the Lichess token and the evaluation cache are local-only. On first start the app copies data from the previous database version (`woodpecker`, then `woodpecker-local`) and leaves the old one untouched.

## Deployment

Every push to `main` is built and published to **GitHub Pages** by `.github/workflows/deploy.yml`. The build uses `BASE_PATH=/<repo-name>/` so the app works under the Pages subpath.

## Credits

- Sync: [Dexie.js](https://dexie.org/) and Dexie Cloud; scheduling: [ts-fsrs](https://github.com/open-spaced-repetition/ts-fsrs)
- Opening data: [Lichess opening explorer and cloud evaluation](https://lichess.org/api)

- Board: [chessground](https://github.com/lichess-org/chessground) (GPL-3.0); move logic: [chess.js](https://github.com/jhlywa/chess.js)
- Engine: [Stockfish.js](https://github.com/nmrugg/stockfish.js) 18 lite, single-threaded, GPL-3.0 (licence in `public/stockfish/COPYING.txt`)
- Puzzles: [Lichess open database](https://database.lichess.org/) (CC0)
- Method: *The Woodpecker Method* by Axel Smith and Hans Tikkanen
