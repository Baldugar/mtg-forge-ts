// SPDX-License-Identifier: GPL-3.0-or-later
// TapAllEffect — taps all permanents matching a ValidCards$ filter.
// Icy Manipulator-style mass tap, Blinding Angel, etc. (5 cards in corpus).
//
// Forge DSL:
//   SP$ TapAll | ValidCards$ Creature.OpponentCtrl
//   SP$ TapAll | ValidCards$ Creature
//   SP$ TapAll | ValidCards$ Permanent.OpponentCtrl
//
// Supported ValidCards$ filter tokens (same pattern as UntapAll / DestroyAll):
//   Creature             — any Creature on battlefield
//   Creature.YouCtrl     — Creature controlled by sa.controllerSeat
//   Creature.OpponentCtrl — Creature NOT controlled by sa.controllerSeat
//   Artifact             — any Artifact on battlefield
//   Enchantment          — any Enchantment on battlefield
//   Land                 — any Land on battlefield
//   Permanent            — any permanent on battlefield (all card types)
//   Permanent.YouCtrl    — all permanents controlled by sa.controllerSeat
//   Permanent.OpponentCtrl — all permanents NOT controlled by sa.controllerSeat
//
// Cards are collected first, then tapped (simultaneous semantics).
import { CardType } from "@mtg-forge-ts/core";
import type { EntityId } from "@mtg-forge-ts/core";
import type { EngineYield } from "../../action/engine-yield.js";
import type { Game } from "../../game.js";
import { effectRegistry } from "../effect-registry.js";
import { evaluateParamRaw, hasParam } from "../evaluate-param.js";
import { SpellAbilityEffect } from "../spell-ability-effect.js";
import type { SpellAbility } from "../spell-ability.js";

function collectMatching(sa: SpellAbility, game: Game): EntityId[] {
  const filterRaw = hasParam(sa, "ValidCards") ? evaluateParamRaw(sa, "ValidCards") : "Creature";
  const tokens = filterRaw.split(".").map((t) => t.trim().toLowerCase());
  const baseType = tokens[0] ?? "creature";
  const qualifier = tokens[1] ?? "";

  const matched: EntityId[] = [];
  for (const [id, card] of game.cards) {
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

export class TapAllEffect extends SpellAbilityEffect {
  static override readonly handlerKey = "TapAll";

  override *resolve(sa: SpellAbility, game: Game): Generator<EngineYield, void, unknown> {
    // Collect first (simultaneous semantics).
    const targets = collectMatching(sa, game);
    for (const cardId of targets) {
      yield* game.action.tap(cardId);
    }
  }
}

effectRegistry.register(TapAllEffect);
