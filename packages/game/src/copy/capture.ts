// SPDX-License-Identifier: GPL-3.0-or-later
// CR 707.2 — capture the copiable values of a card at copy time.
//
// Reads the source's fully-layered Characteristics via LayerEngine and
// freezes the copiable subset. The copy's Layer 1 applier then reinstates
// those values on the target each time computeCharacteristics runs.
//
// Edge cases per CR 707.3-11 (Task 56 handles some of these inline):
//   - Token source: the copy records token-ness via caller setting
//     target.isToken = true after capture. Name is copied from the layered
//     source name (which may already be the token's "Goblin" rather than
//     "Goblin Token").
//   - DFC source: the layered characteristics reflect the currently-visible
//     face — no special handling needed here.
//   - Face-down source: the layered characteristics already include the
//     face-down override (Task 53 applies it in Layer 1). Capture preserves
//     2/2 colorless typeless, but the face-down STATE itself is not copied —
//     unless the caller explicitly propagates `source.faceDown` to the target.
//     The canonical "Cytoshape" answer: target gets the source's current
//     characteristics including face-down values; if the target's own
//     faceDown is {kind: "none"}, it appears face-up with 2/2 no-name.
//   - X-cost copy (stack copies): the X value is a separate slot on the
//     StackItem, not part of CopiableCharacteristics. Task 57 handles.
import type { EntityId } from "@mtg-forge-ts/core";
import type { Game } from "../game.js";
import type { CopiableCharacteristics } from "./copiable-characteristics.js";

export const captureCopiable = (sourceId: EntityId, game: Game): CopiableCharacteristics => {
  const chars = game.layerEngine.computeCharacteristics(sourceId);
  return {
    name: chars.name,
    manaCost: chars.manaCost,
    colorIndicator: chars.colorIndicator,
    supertypes: new Set(chars.supertypes),
    types: new Set(chars.types),
    subtypes: new Set(chars.subtypes),
    colors: chars.colors,
    rulesText: chars.rulesText,
    power: chars.power,
    toughness: chars.toughness,
    loyalty: chars.loyalty,
    defense: chars.defense,
  };
};
