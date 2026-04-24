// SPDX-License-Identifier: GPL-3.0-or-later
// CR 708 — face-down state taxonomy. Each kind carries the data the
// turn-face-up primitive needs to validate and resolve the flip:
//
//   morph    (CR 702.37)  — pay morph cost (special action CR 701.34).
//   manifest (CR 701.34)  — pay the card's actual mana cost (only turnable
//                           face-up if the hidden identity is a creature).
//   foretell (CR 702.146) — cast from exile for the foretell cost beginning
//                           the turn after foretelling.
//   disguise (CR 702.168) — pay disguise cost; the creature has ward N.
//   cloak    (CR 702.170) — pay the actual mana cost; the creature has ward.
//
// Non-face-down cards carry `kind: "none"`; Layer 1 short-circuits on that
// kind, so `card.faceDown` is always a valid `FaceDownState` (never null).
import type { ManaCost } from "../mana/cost.js";

export type FaceDownState =
  | { readonly kind: "none" }
  | { readonly kind: "morph"; readonly cost: ManaCost }
  | { readonly kind: "manifest" }
  | { readonly kind: "foretell"; readonly castableFrom: "exile" }
  | { readonly kind: "disguise"; readonly wardAmount: number }
  | { readonly kind: "cloak" };

/**
 * Canonical default — a card that is NOT face-down. Re-exported from this
 * module so consumers don't hand-write the `{ kind: "none" }` literal
 * everywhere (plus lets us add non-kind defaults later without cascading
 * test rewrites).
 */
export const FACE_UP: FaceDownState = { kind: "none" };
