// SPDX-License-Identifier: GPL-3.0-or-later
// OutsideTheGame — per-player Zone for the engine-side "outside the game"
// surface (CR 100.4). Wave 66 introduces this as an explicit zone so:
//   - `GameAction.conjureCopyToHand` (Double team, CR 702.176) has a
//     concrete reservoir to mint copies into before moving them to hand.
//   - Companion (CR 702.139) can stage the declared companion card in a
//     well-defined source zone before the 3-mana tutor moves it to hand.
//   - Wishes (Burning Wish / Glittering Wish / etc.) can resolve against a
//     well-defined card pool. The "outside the game" zone is the umbrella
//     for both sideboard cards AND cards in the player's collection that
//     aren't in the deck/sideboard; SP6's deck-construction surface
//     populates this once it ships.
//
// Forge models "outside the game" implicitly via Sideboard + absence-of-
// zone fallback; we promote it to a real zone for engine cleanliness. The
// class is a thin Zone subclass with no invariants beyond the base.
import { Zone } from "../zone.js";

export class OutsideTheGame extends Zone {}
