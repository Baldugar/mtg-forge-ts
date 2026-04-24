// SPDX-License-Identifier: GPL-3.0-or-later
// CR 715 — adventure cards. A single card with a creature face ("front")
// and an adventure face ("adventure", instant or sorcery).
//
// Cast flow:
//   • From hand, the casting player picks which face to cast. The
//     CastPipeline step-2 decision offers ["front", "adventure"] when
//     the faces map contains both keys.
//   • Casting the adventure face resolves it, then exiles the card with
//     a special "may cast this as a creature spell" permission. SP2
//     encodes the exile-on-resolve via the cast-pipeline's zone-override
//     step (alternativeZoneDestination = Exile). The re-cast-from-exile
//     permission flag is SP3's domain — the rules DSL adds a
//     `castableFromExile` flag on the exiled card that the LegalActions
//     enumerator consults when building the cast menu.
//
// SP2 scope: detect adventure cards via `isAdventureCard`. The
// cast-pipeline step already reads the faces map and yields chooseFace
// when "adventure" is a key.
import type { PaperCard } from "@mtg-forge-ts/core";

/**
 * True when the PaperCard publishes an "adventure" face slot. Any card
 * with `faces.adventure` counts — single- or multi-keyed.
 */
export const isAdventureCard = (paper: PaperCard): boolean => {
  return paper.faces !== undefined && "adventure" in paper.faces;
};
