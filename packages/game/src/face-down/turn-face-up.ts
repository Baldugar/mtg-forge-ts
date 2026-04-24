// SPDX-License-Identifier: GPL-3.0-or-later
// CR 701.34 / 702.37 / 702.146 / 702.168 / 702.170 — turn-face-up for
// morph, manifest, foretell, disguise, and cloak.
//
// SP2 scope:
//   - Validates that the card is face-down.
//   - Clears `card.faceDown` to { kind: "none" }.
//   - Bumps the LayerEngine epoch so the face-down override in Layer 1
//     stops applying.
//   - Emits CardTurnedFaceUp with the previous face-down kind so triggers
//     ("when CARDNAME is turned face-up") can observe the transition.
//
// Deferred to SP3:
//   - Cost payment (morph/disguise costs; the actual mana cost for
//     manifest/cloak) is handled by SP3's cost pipeline. SP2's primitive
//     trusts the caller that the appropriate cost has been paid.
//   - Hidden-identity validation for manifest/cloak (CR 701.34d: a manifest
//     card can only be turned face-up if its hidden identity is a creature).
//     SP2 doesn't yet bind Card.paperCard.definition for base characteristics,
//     so the rules-level "is the hidden identity a creature" check lives
//     in SP4's CardDb-aware turn-face-up wrapper.
//   - Foretell-specific "after the turn foretold" restriction (CR 702.146).
import type { EntityId } from "@mtg-forge-ts/core";
import { GameStateIntegrityError, mkEvent } from "@mtg-forge-ts/core";
import type { EngineYield } from "../action/engine-yield.js";
import type { Game } from "../game.js";

export function* turnFaceUp(game: Game, cardId: EntityId): Generator<EngineYield, void, unknown> {
  const card = game.cards.get(cardId);
  if (!card) {
    throw new GameStateIntegrityError(`turnFaceUp: card ${cardId} not found`);
  }
  const fd = card.faceDown;
  // Exhaustiveness guard: face-up (kind "none") is not a valid flip source.
  switch (fd.kind) {
    case "none":
      throw new GameStateIntegrityError(`turnFaceUp: card ${cardId} is already face-up`);
    case "morph":
    case "manifest":
    case "foretell":
    case "disguise":
    case "cloak":
      break;
    default: {
      const _never: never = fd;
      throw new Error(`turnFaceUp: unreachable face-down kind ${JSON.stringify(_never)}`);
    }
  }
  const previousKind = fd.kind;
  card.faceDown = { kind: "none" };
  // CR 613.1 — face-down state feeds Layer 1; flip invalidates the cache.
  game.layerEngine.bumpEpoch("turn-face-up");
  yield {
    kind: "event",
    event: mkEvent("CardTurnedFaceUp", game.turn, game.phase, {
      cardId,
      previousKind,
    }),
  };
}
