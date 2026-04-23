// SPDX-License-Identifier: GPL-3.0-or-later
// Compute the pre-layer "base" Characteristics of a Card from its PaperCard.
// This is the input to LayerEngine — Layers 1..7e all apply on top.
//
// SP4 will populate additional base fields from PaperCard.definition once the
// CardDb integration lands. SP2 tolerates absence: anything not already on
// PaperCard (power, toughness, types, colors, rulesText) stays at the empty
// baseline. LayerEngine must be able to run before CardDb is attached.
import { type Characteristics, emptyCharacteristics } from "@mtg-forge-ts/core";
import type { Card } from "../card.js";

export const deriveBaseCharacteristics = (card: Card): Characteristics => {
  const base = emptyCharacteristics();
  if (card.paperCard.name !== undefined) base.name = card.paperCard.name;
  return base;
};
