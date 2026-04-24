// SPDX-License-Identifier: GPL-3.0-or-later
// Compute the pre-layer "base" Characteristics of a Card from its PaperCard.
// This is the input to LayerEngine — Layers 1..7e all apply on top.
//
// SP4 will populate additional base fields from PaperCard.definition once the
// CardDb integration lands. SP2 tolerates absence: anything not already on
// PaperCard (power, toughness, types, colors, rulesText) stays at the empty
// baseline. LayerEngine must be able to run before CardDb is attached.
//
// SP2 Task 58 (Milestone Q) — multi-face support. When PaperCard.faces
// publishes a Record<FaceKind, FaceDefinition> and Card.face points into
// it, we read the face's name from the map instead of paperCard.name.
// Split cards whose face is still "default" use the combined-both-halves
// name per CR 708.4a; all other "default" cases (single-face cards, DFCs
// before any chooseFace selection, etc.) fall through to paperCard.name.
import { type Characteristics, emptyCharacteristics } from "@mtg-forge-ts/core";
import type { Card } from "../card.js";
import { combinedSplitCharacteristics, isSplitCard } from "../multiface/split.js";

export const deriveBaseCharacteristics = (card: Card): Characteristics => {
  const base = emptyCharacteristics();
  const paper = card.paperCard;
  const faces = paper.faces;
  // Face-aware path: PaperCard publishes a faces Record.
  if (faces !== undefined) {
    if (card.face !== "default") {
      const face = faces[card.face];
      if (face !== undefined) {
        base.name = face.name;
        // SP4 populates more fields from PaperCard.definition[card.face].
        return base;
      }
      // Face key not present — fall through to the paperCard.name fallback.
    } else if (isSplitCard(paper)) {
      // CR 708.4a — split cards in non-stack zones use both halves' combined
      // characteristics. The per-face path above is taken only when a half
      // has been chosen (CastPipeline sets Card.face before the stack push).
      return combinedSplitCharacteristics(paper);
    }
  }
  // Fallback: single-face card, or a face key not in the map.
  if (paper.name !== undefined) base.name = paper.name;
  return base;
};
