// Repaso espaciado con FSRS (ts-fsrs). Las fechas se guardan como texto ISO para que se sincronicen tal cual.

import { createEmptyCard, fsrs, Rating, State, type Card, type Grade } from "ts-fsrs";
import { db, type OpeningCard } from "../db";
import { dayKey } from "../stats";

export { Rating };
export type { Grade };

const scheduler = fsrs({ enable_fuzz: true });

export const cardId = (repId: string, pos: string) => `${repId}|${pos}`;

export function newCard(repId: string, pos: string): OpeningCard {
  const c = createEmptyCard(new Date());
  return { id: cardId(repId, pos), repId, pos, ...c, due: c.due.toISOString(), last_review: undefined };
}

const toFsrs = (c: OpeningCard): Card => ({
  ...c, state: c.state as State,
  due: new Date(c.due), last_review: c.last_review ? new Date(c.last_review) : undefined,
});

export async function grade(c: OpeningCard, rating: Grade) {
  const now = new Date();
  const next = scheduler.next(toFsrs(c), now, rating).card;
  const upd: OpeningCard = {
    ...c, ...next,
    due: next.due.toISOString(),
    last_review: next.last_review?.toISOString(),
    introduced: c.introduced ?? now.toISOString(),
  };
  await db.cards.put(upd);
  return upd;
}

export const isNew = (c: OpeningCard) => c.state === State.New;

/** Tarjetas para hoy: las pendientes y, de las nuevas, hasta completar el cupo diario */
export function sessionCards(cards: OpeningCard[], allCards: OpeningCard[], newPerDay: number, now = new Date()) {
  const today = dayKey(now);
  const introducedToday = allCards.filter((c) => c.introduced && dayKey(c.introduced) === today).length;
  const due = cards.filter((c) => !isNew(c) && new Date(c.due) <= now);
  const fresh = cards.filter(isNew).slice(0, Math.max(0, newPerDay - introducedToday));
  return { due, fresh };
}
