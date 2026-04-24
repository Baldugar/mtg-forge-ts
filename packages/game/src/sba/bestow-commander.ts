// SPDX-License-Identifier: GPL-3.0-or-later
// CR 702.103 — bestowed aura in a non-battlefield zone reverts to its
//              creature form. Detected via Card.bestowed being true while
//              the card is NOT on the battlefield; the apply handler
//              clears the flag so the card is treated as a regular
//              creature in its new zone.
// CR 903.9 — A commander in a graveyard, exile, hand, or library may be
//            moved to the command zone (SP2 auto-moves without asking;
//            SP3's replacement-effect pipeline adds the "if it would" hook
//            with the owner's elect decision).
import { ZoneType } from "@mtg-forge-ts/core";
import type { Game } from "../game.js";
import type { SbaAction } from "./sba-action.js";

export const collectBestow = (game: Game, out: SbaAction[]): void => {
  for (const [id, card] of game.cards) {
    if (card.zone === ZoneType.Battlefield) continue;
    if (card.bestowed) {
      out.push({ kind: "bestowAuraReverts", cardId: id });
    }
  }
};

export const collectCommander = (game: Game, out: SbaAction[]): void => {
  for (const [id, card] of game.cards) {
    if (!card.isCommander) continue;
    // A commander on the battlefield or already in the command zone is
    // not a candidate. Graveyard/exile/hand/library are all eligible
    // destinations to re-route to the command zone.
    if (card.zone === ZoneType.Battlefield) continue;
    if (card.zone === ZoneType.Command) continue;
    out.push({ kind: "commanderToCommandZone", cardId: id });
  }
};
