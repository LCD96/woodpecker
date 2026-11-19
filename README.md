# Woodpecker

A mobile-first trainer for the **Woodpecker Method**: solve the same set of tactics puzzles over and over in shrinking cycles (28 → 14 → 7 → 4 → 2 → 1 days) until the patterns become automatic.

It runs entirely in your browser and installs as an app (PWA). Your progress stays on your device, and you can move it to another device with a backup file.

## Features

- **Train:** work through your current cycle on a Lichess-style board (brown board, cburnett pieces). A timer runs on every puzzle, and the header shows your daily pace and progress toward your daily goal.
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
- **Daily goal:** set your minutes per day, track progress and keep a streak.
- **Sync:** export and import all progress, including the puzzle set itself, to continue on another device.

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

## Deployment

Every push to `main` is built and published to **GitHub Pages** by `.github/workflows/deploy.yml`. The build uses `BASE_PATH=/<repo-name>/` so the app works under the Pages subpath.

## Credits

- Board: [chessground](https://github.com/lichess-org/chessground) (GPL-3.0); move logic: [chess.js](https://github.com/jhlywa/chess.js)
- Engine: [Stockfish.js](https://github.com/nmrugg/stockfish.js) 18 lite, single-threaded, GPL-3.0 (licence in `public/stockfish/COPYING.txt`)
- Puzzles: [Lichess open database](https://database.lichess.org/) (CC0)
- Method: *The Woodpecker Method* by Axel Smith and Hans Tikkanen
