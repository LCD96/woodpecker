import { useEffect, useRef } from "react";
import { Chessground } from "@lichess-org/chessground";
import type { Api } from "@lichess-org/chessground/api";
import type { Key } from "@lichess-org/chessground/types";
import "@lichess-org/chessground/assets/chessground.base.css";
import "@lichess-org/chessground/assets/chessground.brown.css";
import "@lichess-org/chessground/assets/chessground.cburnett.css";
import "./board.css";

interface Props {
  fen: string;
  orientation: "white" | "black";
  turnColor: "white" | "black";
  dests: Map<string, string[]>;
  lastMove?: [string, string];
  onMove: (from: string, to: string) => void;
  /** Quién puede mover; por defecto el color de abajo */
  movableColor?: "white" | "black" | "both";
}

export function Board({ fen, orientation, turnColor, dests, lastMove, onMove, movableColor }: Props) {
  const el = useRef<HTMLDivElement>(null);
  const cg = useRef<Api | undefined>(undefined);

  useEffect(() => {
    cg.current = Chessground(el.current!, { animation: { duration: 300 }, coordinates: true, highlight: { lastMove: true, check: true } });
    return () => cg.current?.destroy();
  }, []);

  useEffect(() => {
    cg.current?.set({
      fen, orientation, turnColor,
      lastMove: lastMove as Key[] | undefined,
      movable: {
        free: false,
        color: movableColor ?? orientation,
        dests: dests as Map<Key, Key[]>,
        events: { after: (from, to) => onMove(from, to) },
      },
    });
  }, [fen, orientation, turnColor, dests, lastMove, onMove, movableColor]);

  return <div className="board-wrap"><div ref={el} /></div>;
}
