// SPDX-License-Identifier: GPL-3.0-or-later
// CR 708 — split cards. Two independently-castable halves ("L" / "R")
// on a single physical card.
//   • On the stack (CR 708.4): only the chosen half's characteristics
//     apply. CastPipeline step 2 yields `chooseFace`; the selected
//     face is mirrored onto Card.face before the stack push so
//     layer derivation picks the right face.
//   • In non-stack zones (CR 708.4a): both halves' characteristics are
//     combined. SP2 approximates this with `combinedSplitCharacteristics`
//     — name joined by " // "; type / subtype / mana-cost union lands
//     once SP4's per-face CardDefinition populates the richer fields.
//
// Aftermath is a CR 702.133 subtype attached to the R half of a split
// card. Restrictions (castable-only-from-graveyard, exile after
// resolution) are encoded by the cast-pipeline step 3 (zone override
// sets alternativeZoneDestination = Exile when origin is Graveyard) —
// no special-case code here.
import type { Characteristics, PaperCard } from "@mtg-forge-ts/core";
import { emptyCharacteristics } from "@mtg-forge-ts/core";

/**
 * True when the PaperCard carries both "L" and "R" face definitions.
 * Type-predicate helper used by the cast pipeline + tests to branch on
 * split-card behavior.
 */
export const isSplitCard = (paperCard: PaperCard): boolean => {
  const faces = paperCard.faces;
  if (faces === undefined) return false;
  return "L" in faces && "R" in faces;
};

/**
 * True when the R half carries the "Aftermath" subtype on its
 * FaceDefinition.subtypes set. Used by the cast-pipeline zone-override
 * step to enforce "R-only from graveyard" restrictions in SP3.
 */
export const isAftermathCard = (paperCard: PaperCard): boolean => {
  if (!isSplitCard(paperCard)) return false;
  const rFace = paperCard.faces?.R;
  return rFace?.subtypes?.has("Aftermath") === true;
};

/**
 * CR 708.4a — combined off-stack characteristics for split cards.
 *
 * SP2 scope: name concatenation as "L // R". Type line, subtype union,
 * combined colors, combined mana cost live on the richer Characteristics
 * SP4 introduces; the placeholder here is enough for zone-based lookups
 * (graveyard search, exile queries) to find a card by either printed
 * half-name.
 *
 * Returns an empty characteristics object when the faces map is absent
 * or missing L/R — the caller (typically base-characteristics derivation)
 * is responsible for picking the right fallback path.
 */
export const combinedSplitCharacteristics = (paperCard: PaperCard): Characteristics => {
  const base = emptyCharacteristics();
  const faces = paperCard.faces;
  if (faces === undefined) return base;
  const left = faces.L;
  const right = faces.R;
  if (left !== undefined && right !== undefined) {
    base.name = `${left.name} // ${right.name}`;
  }
  return base;
};
