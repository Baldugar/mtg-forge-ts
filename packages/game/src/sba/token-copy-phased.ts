// SPDX-License-Identifier: GPL-3.0-or-later
// CR 704.5d/e + 702.26c — token cleanup, copy reversion, phased-out owner
// leaves game.
//
// CR 704.5d — A token in any zone OTHER than the battlefield ceases to
//             exist. Token factories (SP2 Milestone L) set Card.isToken
//             to true at creation; this collector picks them up wherever
//             they land outside the battlefield.
// CR 704.5e — A non-token card with copiedFrom set that is in any zone
//             other than the battlefield reverts to its printed form.
//             We express this as a "revert copiedFrom" SBA; the apply
//             dispatch clears the flag.
// CR 702.26c — When a player leaves the game, any phased-out permanent
//             owned by them leaves the game too. SP2 has no "leave the
//             game" machinery yet (Milestone L), so this collector is a
//             documented stub returning no actions.
import { ZoneType } from "@mtg-forge-ts/core";
import type { Game } from "../game.js";
import type { SbaAction } from "./sba-action.js";

export const collectTokenAndCopy = (game: Game, out: SbaAction[]): void => {
  for (const [id, card] of game.cards) {
    if (card.zone === ZoneType.Battlefield) continue;
    // Token in non-battlefield → cease.
    if (card.isToken) {
      out.push({ kind: "tokenCeaseExistence", cardId: id });
      continue; // tokens don't double up with copy-revert
    }
    // Copy in non-battlefield → revert.
    if (card.copiedFrom !== null) {
      out.push({ kind: "copyRevert", cardId: id });
    }
  }
};

export const collectPhasedOwnerLeaves = (_game: Game, _out: SbaAction[]): void => {
  // CR 702.26c — SP2 stub. Implemented fully once Milestone L adds the
  // "leave the game" cleanup flow; until then, no player formally leaves
  // the game (a loss sets terminalState but leaves the cards in place),
  // so this SBA has nothing to observe.
};
