// SPDX-License-Identifier: GPL-3.0-or-later
// CR 712.6 — modal double-faced cards (MDFCs). Both faces are castable
// from hand; the casting player picks which face at cast (CastPipeline
// step 2). No transformation — the chosen face is what enters the
// battlefield, and stays.
//
// MDFCs and transform DFCs share the `faces: { front, back }` shape.
// The structural discriminator is `PaperCard.isModalDfc`. This helper
// is the single read point for that flag so downstream code (cast
// pipeline, tests) doesn't encode the convention ad-hoc.
import type { PaperCard } from "@mtg-forge-ts/core";

/**
 * True when the PaperCard is flagged as a modal DFC. The flag must
 * accompany a `faces` map with "front" and "back" keys for the card to
 * work in practice, but this helper only reads the flag — callers that
 * also need face structural validation should combine with the split/
 * transform helpers.
 */
export const isModalDfc = (paper: PaperCard): boolean => {
  return paper.isModalDfc === true;
};
