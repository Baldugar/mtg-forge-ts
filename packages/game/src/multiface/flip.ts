// SPDX-License-Identifier: GPL-3.0-or-later
// CR 709 — Kamigawa-style "flip" cards. Single physical face; a
// triggered or activated ability flips the permanent in-place,
// revealing the other half's characteristics. The flipped state
// persists until the card leaves the battlefield.
//
// Representation: Card.face toggles between "default" (the unflipped
// printed name) and "flipped" (the bottom-half name). PaperCard.faces
// carries a "flipped" slot with the alt face's data.
//
// SP2 scope: the state-mutation primitive only — the trigger/ability
// that calls flip() is a card-data concern owned by SP3's rules DSL.
// The primitive validates the card exists and is a flip card, toggles
// the face, bumps the layer epoch, and emits `Flipped`.
import type { EntityId } from "@mtg-forge-ts/core";
import { GameStateIntegrityError, mkEvent } from "@mtg-forge-ts/core";
import type { PaperCard } from "@mtg-forge-ts/core";
import type { EngineYield } from "../action/engine-yield.js";
import type { Game } from "../game.js";

/**
 * True when the PaperCard publishes a "flipped" face definition. The
 * "default"/"flipped" pair is the flip-card signature; transform DFCs
 * use "front"/"back" instead.
 */
export const isFlipCard = (paper: PaperCard): boolean => {
  return paper.faces !== undefined && "flipped" in paper.faces;
};

/**
 * Toggle a flip card's active face ("default" ↔ "flipped"). Idempotent-
 * safe — every call flips whichever face is currently active.
 *
 * The epoch bump lets any Layer-1..7 effect whose scoping depends on
 * the flipped state (text-changing statics, ability grants wired to
 * the flipped name, etc.) refresh on the next read.
 */
export function* flip(game: Game, cardId: EntityId): Generator<EngineYield, void, unknown> {
  const card = game.cards.get(cardId);
  if (!card) throw new GameStateIntegrityError(`flip: card ${cardId} not found`);
  if (!isFlipCard(card.paperCard)) {
    throw new GameStateIntegrityError(`flip: ${cardId} is not a flip card`);
  }
  // CR 709.3 — the flip toggles between the printed face and the
  // flipped face. "default" is our sentinel for the unflipped state;
  // any transient intermediate face gets reset to "flipped" here.
  card.face = card.face === "flipped" ? "default" : "flipped";
  game.layerEngine.bumpEpoch("flip");
  yield {
    kind: "event",
    event: mkEvent("Flipped", game.turn, game.phase, { cardId }),
  };
}
