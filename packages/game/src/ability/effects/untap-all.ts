// SPDX-License-Identifier: GPL-3.0-or-later
// UntapAllEffect — untaps all permanents matching a ValidCards$ filter.
// Awakening, Vitalize, etc. (7 cards in corpus).
//
// Forge DSL:
//   SP$ UntapAll | ValidCards$ Permanent.YouCtrl
//   SP$ UntapAll | ValidCards$ Creature
//   SP$ UntapAll | ValidCards$ Land.YouCtrl
//
// Supported ValidCards$ filter tokens (same pattern as DestroyAll / TapAll):
//   Creature             — any Creature on battlefield
//   Creature.YouCtrl     — Creature controlled by sa.controllerSeat
//   Creature.OpponentCtrl — Creature NOT controlled by sa.controllerSeat
//   Artifact             — any Artifact on battlefield
//   Enchantment          — any Enchantment on battlefield
//   Land                 — any Land on battlefield
//   Land.YouCtrl         — Land controlled by sa.controllerSeat
//   Permanent            — any permanent on battlefield (all card types)
//   Permanent.YouCtrl    — all permanents controlled by sa.controllerSeat
//
// Cards are collected first, then untapped (simultaneous semantics).
import { CardType, ZoneType, mkEvent } from "@mtg-forge-ts/core";
import type { EntityId } from "@mtg-forge-ts/core";
import type { EngineYield } from "../../action/engine-yield.js";
import type { Game } from "../../game.js";
import { effectRegistry } from "../effect-registry.js";
import { evaluateParamRaw, hasParam } from "../evaluate-param.js";
import { SpellAbilityEffect } from "../spell-ability-effect.js";
import type { SpellAbility } from "../spell-ability.js";

function collectMatching(sa: SpellAbility, game: Game): EntityId[] {
  const filterRaw = hasParam(sa, "ValidCards") ? evaluateParamRaw(sa, "ValidCards") : "Permanent";
  const tokens = filterRaw.split(".").map((t) => t.trim().toLowerCase());
  const baseType = tokens[0] ?? "permanent";
  const qualifier = tokens[1] ?? "";

  const matched: EntityId[] = [];
  for (const [id, card] of game.cards) {
    // Zone guard: UntapAll targets battlefield permanents only (CR 700.7).
    if (card.zone !== ZoneType.Battlefield) continue;

    const chars = game.layerEngine.computeCharacteristics(id);

    if (baseType !== "permanent") {
      if (baseType === "creature" && !chars.types.has(CardType.Creature)) continue;
      if (baseType === "artifact" && !chars.types.has(CardType.Artifact)) continue;
      if (baseType === "enchantment" && !chars.types.has(CardType.Enchantment)) continue;
      if (baseType === "land" && !chars.types.has(CardType.Land)) continue;
    }

    if (qualifier === "youctrl" && card.controllerSeat !== sa.controllerSeat) continue;
    if (qualifier === "opponentctrl" && card.controllerSeat === sa.controllerSeat) continue;

    matched.push(id);
  }
  return matched;
}

export class UntapAllEffect extends SpellAbilityEffect {
  static override readonly handlerKey = "UntapAll";

  override *resolve(sa: SpellAbility, game: Game): Generator<EngineYield, void, unknown> {
    // Collect first (simultaneous semantics).
    const targets = collectMatching(sa, game);
    for (const cardId of targets) {
      yield* game.action.untap(cardId);
    }
    // Wave 16b — CardsUntappedAll batch event (Forge T:Mode$ UntapAll).
    // Skip empty resolutions to avoid vacuous trigger fires.
    if (targets.length > 0) {
      yield game.emitEvent(
        mkEvent("CardsUntappedAll", game.turn, game.phase, {
          cardIds: [...targets],
        }),
      );
    }
  }
}

effectRegistry.register(UntapAllEffect);
