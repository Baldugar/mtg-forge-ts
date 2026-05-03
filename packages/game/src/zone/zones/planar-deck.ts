// SPDX-License-Identifier: GPL-3.0-or-later
// PlanarDeck — per-player Zone for the Planechase variant (CR 901). A
// planar deck is an ordered, hidden, face-down pile of Plane and Phenomenon
// cards used in the Planechase variant. CR 901.6 specifies that when a
// player would planeswalk, they reveal cards from the top of their planar
// deck until a Plane is revealed; that Plane becomes the active plane.
//
// The class is a thin Zone subclass — PlanarDeck behaves as an ordered
// face-down pile (membership in DECK_ZONES + ORDERED_ZONES is established
// in core/src/zone.ts) and the base Zone's add/remove/clear semantics
// already preserve insertion order, which is sufficient for SP1's needs:
// the host loads cards in deck order and the engine pops the top.
import { Zone } from "../zone.js";

export class PlanarDeck extends Zone {}
