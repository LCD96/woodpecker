import fs from "node:fs";
import { Decompress } from "fzstd";

const ARCHIVO = "data/lichess_db_puzzle.csv.zst";
const MOTIVOS = ["fork", "pin", "skewer", "discoveredAttack", "deflection", "attraction",
  "sacrifice", "quietMove", "hangingPiece", "trappedPiece", "capturingDefender",
  "intermezzo", "backRankMate", "xRayAttack", "clearance", "interference", "endgame"];
const TOTAL = 500;
const POR_MOTIVO = Math.ceil(TOTAL / MOTIVOS.length);
const CANDIDATOS = POR_MOTIVO * 10;   // candidatos por motivo antes de parar

if (!fs.existsSync(ARCHIVO)) {
  console.error(`No encuentro ${ARCHIVO}. Ejecuta el script desde la raíz del proyecto.`);
  process.exit(1);
}

const tamano = fs.statSync(ARCHIVO).size;
const cand = Object.fromEntries(MOTIVOS.map((m) => [m, []]));
let header = null, resto = "", leidos = 0, lineas = 0, terminado = false;
const dec = new TextDecoder();

function procesar(linea) {
  lineas++;
  const f = linea.split(",");
  if (!header) { header = f; return; }
  const r = Object.fromEntries(header.map((h, i) => [h, f[i]]));
  const rating = +r.Rating;
  if (rating < 1600 || rating > 2000) return;
  if (+r.Popularity < 80 || +r.NbPlays < 1000 || +r.RatingDeviation > 80) return;
  const temas = r.Themes.split(" ");
  const m = MOTIVOS.find((x) => temas.includes(x) && cand[x].length < CANDIDATOS);
  if (m) cand[m].push({ id: r.PuzzleId, fen: r.FEN, moves: r.Moves.split(" "), rating, themes: temas });
}

const completo = () => MOTIVOS.every((m) => cand[m].length >= CANDIDATOS);
const barajar = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

function terminar() {
  if (terminado) return;
  terminado = true;
  clearInterval(reloj);
  const elegidos = MOTIVOS.flatMap((m) => barajar(cand[m]).slice(0, POR_MOTIVO));
  const final = barajar([...new Map(elegidos.map((p) => [p.id, p])).values()]).slice(0, TOTAL);
  fs.mkdirSync("src/data", { recursive: true });
  fs.writeFileSync("src/data/puzzles.json", JSON.stringify(final));
  console.log("\nCandidatos por motivo:", Object.fromEntries(MOTIVOS.map((m) => [m, cand[m].length])));
  console.log(`Guardados ${final.length} puzzles en src/data/puzzles.json`);
}

const zstd = new Decompress((chunk, final) => {
  resto += dec.decode(chunk, { stream: !final });
  const ls = resto.split("\n");
  resto = ls.pop();
  for (const l of ls) if (l) procesar(l);
  if (final && resto) procesar(resto);
});

const stream = fs.createReadStream(ARCHIVO);
const reloj = setInterval(() => {
  const llenos = MOTIVOS.filter((m) => cand[m].length >= CANDIDATOS).length;
  process.stdout.write(`\r${(leidos / tamano * 100).toFixed(1)} % leído · ${lineas.toLocaleString()} puzzles revisados · ${llenos}/${MOTIVOS.length} motivos completos   `);
}, 1000);

stream
  .on("data", (c) => {
    leidos += c.length;
    zstd.push(new Uint8Array(c));
    if (completo()) { stream.destroy(); terminar(); }
  })
  .on("end", () => { zstd.push(new Uint8Array(0), true); terminar(); })
  .on("error", (e) => { console.error(e); process.exit(1); });