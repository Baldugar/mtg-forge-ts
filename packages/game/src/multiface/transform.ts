// SPDX-License-Identifier: GPL-3.0-or-later
// CR 711 — transform mechanic. Double-faced cards (werewolves, Innistrad
// DFCs) transform in-place via triggers / spell effects. The active face
// is tracked on Card.face ("front" ↔ "back"); the physical card stays
// put, but its characteristics come from the new face.
//
// Shared card shape with modal DFCs (CR 712.6): PaperCard.faces has
// "front" and "back" keys, both as FaceDefinition. The discriminator
// is `PaperCard.isModalDfc` — modal DFCs pick the cast-time face via
// CastPipeline step 2 and never transform, whereas transform DFCs cast
// as "front" and flip sides when transform() is invoked.
//
// SP2 scope: the state-mutation primitive only. The trigger / activated
// ability that calls transform() is authored in SP3's DSL.
import type { EntityId } from "@mtg-forge-ts/core";
import { GameStateIntegrityError, mkEvent } from "@mtg-forge-ts/core";
import type { PaperCard } from "@mtg-forge-ts/core";
import type { EngineYield } from "../action/engine-yield.js";
import type { Game } from "../game.js";
import { canTransform } from "../statics/wave60-cant-gates.js";

/**
 * True when PaperCard.faces carries both "front" and "back" entries
 * AND the card is NOT flagged as a modal DFC. The MDFC / transform DFC
 * distinction is structural on PaperCard — transform DFCs omit the
 * `isModalDfc` flag; modal DFCs set it.
 */
export const isTransformDfc = (paper: PaperCard): boolean => {
  const faces = paper.faces;
  if (faces === undefined) return false;
  if (!("front" in faces) || !("back" in faces)) return false;
  return paper.isModalDfc !== true;
};

/**
 * Toggle a transform DFC's active face. "front" ↔ "back"; any unknown
 * starting face is normalized to "back" (we treat the pre-cast "default"
 * as though the card were on the front — calling transform() on a card
 * that hasn't chosen a face yet makes intuitive sense: it flips to
 * "back").
 *
 * Emits Transformed with toFace = the NEW active face so subscribers
 * see the post-toggle state. Bumps the layer epoch so any characteristic
 * cached prior to the flip is invalidated.
 */
export function* transform(game: Game, cardId: EntityId): Generator<EngineYield, void, unknown> {
  const card = game.cards.get(cardId);
  if (!card) throw new GameStateIntegrityError(`transform: card ${cardId} not found`);
  if (!isTransformDfc(card.paperCard)) {
    throw new GameStateIntegrityError(`transform: ${cardId} is not a transform DFC`);
  }
  // Wave 60.H — CR 701.32 transform-prevention static. Walks the
  // registry for active CantTransform modes; on a match no Transformed
  // event fires, no face change, no layer-epoch bump. Mirrors Forge's
  // silent-skip semantics for static transform-prevention effects.
  if (!canTransform(game, cardId)) {
    return;
  }
  // CR 711.4 — toggle. "back" → "front", anything else → "back".
  const toFace: "front" | "back" = card.face === "back" ? "front" : "back";
  card.face = toFace;
  game.layerEngine.bumpEpoch("transform");
  yield {
    kind: "event",
    event: mkEvent("Transformed", game.turn, game.phase, { cardId, toFace }),
  };
}
