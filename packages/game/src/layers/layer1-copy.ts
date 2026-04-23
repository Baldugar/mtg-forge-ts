// SPDX-License-Identifier: GPL-3.0-or-later
// CR 613.1a — copy effects overwrite an object's copiable characteristics.
// Layers 2..7 then apply on top. Full edge cases (tokens, DFC, face-down,
// stack copy, X-cost copy) land in Task 55; Layer 1 here handles the plain
// "becomes a copy of X" case — target inherits copiable values verbatim.
//
// Non-copiable state (counters, damage, attachments, abilities array) is
// untouched: the `abilities` field on Characteristics represents currently-
// active refs (re-populated from layer 6 on subsequent walks), not copied
// ability text.
//
// Forge ref: forge.game.staticability.StaticAbilityCopy (CopyCardName branch).
import type { Characteristics } from "@mtg-forge-ts/core";
import type { CopiableCharacteristics } from "../copy/copiable-characteristics.js";

export const applyLayer1Copy = (target: Characteristics, source: CopiableCharacteristics | null): void => {
  if (source === null) return;
  target.name = source.name;
  target.manaCost = source.manaCost;
  target.colorIndicator = source.colorIndicator;
  target.supertypes = new Set(source.supertypes);
  target.types = new Set(source.types);
  target.subtypes = new Set(source.subtypes);
  target.colors = source.colors;
  target.rulesText = source.rulesText;
  target.power = source.power;
  target.toughness = source.toughness;
  target.loyalty = source.loyalty;
  target.defense = source.defense;
};
