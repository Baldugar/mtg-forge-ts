// SPDX-License-Identifier: GPL-3.0-or-later
// A single face of a multi-face card. SP2 carries the minimum shape
// (name); SP4 extends with typeLine/manaCost/colors/rulesText/P/T/etc.
// via PaperCard.definition.
//
// Used by split / flip / transform-DFC / modal-DFC / adventure / meld
// cards via PaperCard.faces (a Record<faceKey, FaceDefinition>). The
// live Card's `face: FaceKind` selects which face's data applies for
// the base-characteristics derivation (SP2) and will drive
// SP4 layer-derived values (P/T, types, etc.) once PaperCard.definition
// per-face lands.
//
// `subtypes` is opt-in so helpers like `isAftermathCard` can inspect
// the right-half subtype set without requiring the full definition
// surface. SP4 moves this onto the CardDefinition per-face.
export interface FaceDefinition {
  readonly name: string;
  // SP2 Task 58 — opt-in subtype set used by multi-face helpers. The R
  // half of an Aftermath split carries "Aftermath" here; meld faces may
  // declare supertype-adjacent tags ("Legendary") once SP3 wires them.
  readonly subtypes?: ReadonlySet<string>;
}
