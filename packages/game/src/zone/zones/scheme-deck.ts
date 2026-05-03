// SPDX-License-Identifier: GPL-3.0-or-later
// SchemeDeck — per-player Zone for the Archenemy variant (CR 904). The
// archenemy's scheme deck is an ordered, hidden, face-down pile of Scheme
// cards. CR 904.7: at the beginning of each archenemy's upkeep, that
// player sets the top card of their scheme deck in motion — moves it to
// the command zone face-up where its triggered abilities resolve.
//
// The class is a thin Zone subclass — SchemeDeck behaves as an ordered
// face-down pile (membership in DECK_ZONES + ORDERED_ZONES is established
// in core/src/zone.ts) and the base Zone's add/remove/clear semantics
// already preserve insertion order, which is sufficient for SP1's needs:
// the host loads cards in deck order and the engine pops the top via
// GameAction.setInMotion.
import { Zone } from "../zone.js";

export class SchemeDeck extends Zone {}
