// SPDX-License-Identifier: GPL-3.0-or-later
// CR 704.5r — if a permanent has both +1/+1 and -1/-1 counters, remove N
// from each where N is the min of the two counts. The cancel is
// simultaneous (CR 704.3); the SBA engine applies this as a single
// "countersPairwiseCancel" action recording the pre-cancel counts so
// observers can derive the delta.
import { CounterType, ZoneType } from "@mtg-forge-ts/core";
import type { Game } from "../game.js";
import type { SbaAction } from "./sba-action.js";

export const collectCounterCancel = (game: Game, out: SbaAction[]): void => {
  for (const [id, card] of game.cards) {
    if (card.zone !== ZoneType.Battlefield) continue;
    const plus = card.counters.get(CounterType.PlusOnePlusOne) ?? 0;
    const minus = card.counters.get(CounterType.MinusOneMinusOne) ?? 0;
    if (plus > 0 && minus > 0) {
      out.push({
        kind: "countersPairwiseCancel",
        cardId: id,
        plusCount: plus,
        minusCount: minus,
      });
    }
  }
};
