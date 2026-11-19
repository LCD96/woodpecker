// Stockfish 18 lite (WASM, un hilo) en un Web Worker. Los ficheros están en public/stockfish.

export interface EngineLine {
  multipv: number;
  depth: number;
  /** Desde el punto de vista de las blancas */
  cp?: number;
  mate?: number;
  pv: string[];              // jugadas UCI
}

type Listener = (fen: string, lines: EngineLine[]) => void;

class Engine {
  private worker?: Worker;
  private ready = false;
  private queue: string[] = [];        // órdenes enviadas antes de "uciok"
  private searching = false;
  private current?: string;           // FEN analizándose
  private pending?: string;           // FEN esperando a que termine la búsqueda anterior
  private lines: EngineLine[] = [];
  private listener?: Listener;
  readonly depth = 22;
  readonly multiPv = 3;

  private boot() {
    if (this.worker) return;
    this.worker = new Worker(`${import.meta.env.BASE_URL}stockfish/stockfish-18-lite-single.js`);
    this.worker.onmessage = (e) => this.onLine(String(e.data));
    this.worker.postMessage("uci");
  }

  private send(cmd: string) {
    if (this.ready) this.worker!.postMessage(cmd);
    else this.queue.push(cmd);
  }

  analyse(fen: string, listener: Listener) {
    this.boot();
    this.listener = listener;
    if (this.searching) {
      this.pending = fen;
      this.send("stop");                // al llegar "bestmove" arrancamos la pendiente
    } else this.start(fen);
  }

  stop() {
    this.pending = undefined;
    this.listener = undefined;
    if (this.searching) this.send("stop");
  }

  private start(fen: string) {
    this.current = fen;
    this.lines = [];
    this.searching = true;
    this.send(`position fen ${fen}`);
    this.send(`go depth ${this.depth}`);
  }

  private onLine(line: string) {
    if (line === "uciok") {
      this.ready = true;
      this.send(`setoption name MultiPV value ${this.multiPv}`);
      this.queue.splice(0).forEach((c) => this.send(c));
      return;
    }
    if (line.startsWith("bestmove")) {
      this.searching = false;
      if (this.pending) { const f = this.pending; this.pending = undefined; this.start(f); }
      return;
    }
    if (!line.startsWith("info") || !line.includes(" pv ") || this.pending) return;
    const tok = line.split(" ");
    const val = (k: string) => { const i = tok.indexOf(k); return i >= 0 ? tok[i + 1] : undefined; };
    const whiteToMove = this.current!.split(" ")[1] === "w";
    const sign = whiteToMove ? 1 : -1;
    const score = tok.indexOf("score");
    const kind = tok[score + 1], n = Number(tok[score + 2]);
    const l: EngineLine = {
      multipv: Number(val("multipv") ?? 1),
      depth: Number(val("depth")),
      cp: kind === "cp" ? n * sign : undefined,
      mate: kind === "mate" ? n * sign : undefined,
      pv: tok.slice(tok.indexOf("pv") + 1),
    };
    this.lines[l.multipv - 1] = l;
    this.listener?.(this.current!, this.lines.filter(Boolean));
  }
}

export const engine = new Engine();

export const fmtEval = (l?: EngineLine) =>
  !l ? "…" : l.mate !== undefined ? `${l.mate > 0 ? "" : "-"}M${Math.abs(l.mate)}` : `${l.cp! > 0 ? "+" : ""}${(l.cp! / 100).toFixed(1)}`;

/** 0..1, proporción de la barra para las blancas */
export const evalToBar = (l?: EngineLine) => {
  if (!l) return 0.5;
  if (l.mate !== undefined) return l.mate > 0 ? 1 : 0;
  return 1 / (1 + Math.exp(-0.004 * l.cp!));
};
