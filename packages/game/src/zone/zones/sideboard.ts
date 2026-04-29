// SPDX-License-Identifier: GPL-3.0-or-later
// Sideboard — per-player Zone for sideboard cards. CR 100.4 / 100.5: a
// sideboard is the set of cards a player may swap into their deck between
// games (constructed) or draft (limited). Wave 66 promotes Sideboard to a
// concrete Zone class so:
//   - Companion's "outside the game → hand" 3-mana once-per-game tutor has
//     a real source zone the validation pipeline can consult.
//   - Learn's "lesson tutor" branch (CR 701.27a) can search the sideboard
//     for cards with subtype Lesson.
//   - Wishes (Burning Wish / Glittering Wish / etc.) can resolve against a
//     well-defined card pool.
//
// The class is a thin Zone subclass — Sideboard has no internal ordering
// invariants (CR 100.6: cards in a sideboard have no positional meaning),
// no on-add / on-remove triggers, and no per-zone activated-ability gating
// beyond what the base Zone provides.
import { Zone } from "../zone.js";

export class Sideboard extends Zone {}
