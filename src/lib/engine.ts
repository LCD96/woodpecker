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

export interface SearchOptions {
  depth?: number;
  multiPv?: number;
  /** Al terminar la búsqueda (o al interrumpirla otra), con las líneas que haya */
  onDone?: (lines: EngineLine[]) => void;
}

class Engine {
  private worker?: Worker;
  private ready = false;
  private queue: string[] = [];        // órdenes enviadas antes de "uciok"
  private searching = false;
  private current?: string;           // FEN analizándose
  private pending?: string;           // FEN esperando a que termine la búsqueda anterior
  private lines: EngineLine[] = [];
  private listener?: Listener;
  private opts: SearchOptions = {};
  private pendingOpts: SearchOptions = {};
  private multiPvSet = 0;
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

  analyse(fen: string, listener: Listener, opts: SearchOptions = {}) {
    this.boot();
    this.listener = listener;
    if (this.searching) {
      this.pendingOpts.onDone?.([]);          // la pendiente anterior ya no se buscará
      this.pending = fen;
      this.pendingOpts = opts;
      this.send("stop");                // al llegar "bestmove" arrancamos la pendiente
    } else this.start(fen, opts);
  }

  /** Una búsqueda que acaba sola; resuelve con las líneas finales */
  evaluate(fen: string, depth = 16, multiPv = 1): Promise<EngineLine[]> {
    return new Promise((resolve) => this.analyse(fen, () => {}, { depth, multiPv, onDone: resolve }));
  }

  stop() {
    this.pendingOpts.onDone?.([]);
    this.pendingOpts = {};
    this.pending = undefined;
    this.listener = undefined;
    if (this.searching) this.send("stop");
  }

  private start(fen: string, opts: SearchOptions) {
    this.current = fen;
    this.opts = opts;
    this.lines = [];
    this.searching = true;
    const mpv = opts.multiPv ?? this.multiPv;
    if (mpv !== this.multiPvSet) { this.send(`setoption name MultiPV value ${mpv}`); this.multiPvSet = mpv; }
    this.send(`position fen ${fen}`);
    this.send(`go depth ${opts.depth ?? this.depth}`);
  }

  private onLine(line: string) {
    if (line === "uciok") {
      this.ready = true;
      this.queue.splice(0).forEach((c) => this.send(c));
      return;
    }
    if (line.startsWith("bestmove")) {
      this.searching = false;
      this.opts.onDone?.(this.lines.filter(Boolean));
      if (this.pending) {
        const f = this.pending, o = this.pendingOpts;
        this.pending = undefined; this.pendingOpts = {};
        this.start(f, o);
      }
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
