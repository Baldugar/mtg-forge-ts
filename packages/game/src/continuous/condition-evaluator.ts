// SPDX-License-Identifier: GPL-3.0-or-later
// Evaluate a ConditionAst against the current game state.
//
// Lives in @mtg-forge-ts/game (not core) because the predicates query
// Game-level artifacts: LayerEngine-computed Characteristics, Card zone,
// Card tapped flag, Player life. Keeping the AST in core and the
// evaluator here is the same split as StaticAbility (data in core,
// behavior in game).
//
// Evaluator semantics:
//   - always / never   — constants.
//   - and / or / not   — short-circuit boolean evaluation.
//   - cardHasType      — queries LayerEngine.computeCharacteristics so
//                        Layer 4 type-changes (losing "Creature" via
//                        Humility, etc.) are respected. Unknown card id
//                        returns false (not-present ≡ does-not-have).
//   - cardInZone       — reads Card.zone. Unknown card → false.
//   - cardTapped       — reads Card.tapped. Unknown card → false.
//   - playerHasLife    — reads Player.life. Unknown seat → false.
//
// Exhaustiveness is enforced via the never-fallback guard so a new AST
// variant can't silently default to false (that would leak a continuous
// effect past its asLongAs expiry).
import type { ConditionAst } from "@mtg-forge-ts/core";
import type { Game } from "../game.js";

export const evalCondition = (cond: ConditionAst, game: Game): boolean => {
  switch (cond.kind) {
    case "always":
      return true;
    case "never":
      return false;
    case "and":
      return evalCondition(cond.left, game) && evalCondition(cond.right, game);
    case "or":
      return evalCondition(cond.left, game) || evalCondition(cond.right, game);
    case "not":
      return !evalCondition(cond.inner, game);
    case "cardHasType": {
      const card = game.cards.get(cond.cardId);
      if (!card) return false;
      // Read through the LayerEngine so Layer 4 add/remove-type effects
      // are honored (a creature that lost its creature type via Humility
      // no longer satisfies cardHasType(Creature)).
      const chars = game.layerEngine.computeCharacteristics(cond.cardId);
      return chars.types.has(cond.cardType);
    }
    case "cardInZone": {
      const card = game.cards.get(cond.cardId);
      return card?.zone === cond.zone;
    }
    case "cardTapped": {
      const card = game.cards.get(cond.cardId);
      return card?.tapped ?? false;
    }
    case "playerHasLife": {
      const player = game.players.find((p) => p.seat === cond.seat);
      if (!player) return false;
      return player.life >= cond.atLeast;
    }
    default: {
      const _: never = cond;
      throw new Error(`evalCondition: unreachable ${JSON.stringify(_)}`);
    }
  }
};
