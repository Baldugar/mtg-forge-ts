// SPDX-License-Identifier: GPL-3.0-or-later
// DestroyAllEffect — destroys all permanents matching a ValidCards$ filter.
// Wrath of God, Damnation, Day of Judgment, etc. (21 cards in corpus).
//
// Forge DSL:
//   SP$ DestroyAll | Cost$ 2 W W | ValidCards$ Creature | NoRegen$ True
//   SP$ DestroyAll | Cost$ 4 B B | ValidCards$ Creature  (Damnation)
//
// Supported ValidCards$ filter tokens (same as PumpAll MVP set):
//   Creature            — any Creature on battlefield
//   Creature.YouCtrl    — Creature controlled by sa.controllerSeat
//   Creature.OpponentCtrl — Creature NOT controlled by sa.controllerSeat
//   Artifact            — any Artifact on battlefield
//   Enchantment         — any Enchantment on battlefield
//   Land                — any Land on battlefield
//   Permanent           — any permanent on battlefield (unfiltered by type)
//
// NoRegen$ True is noted but regeneration-shield consumption is deferred to
// F2 (the ReplacementAbility shield-intercept). Cards on the battlefield are
// scanned; game.action.destroy is called on each match. Cards are collected
// first, then destroyed (all-at-once simultaneous-destroy semantics per CR
// 700.7), preventing one destruction from triggering before another resolves.
import { CardType } from "@mtg-forge-ts/core";
import type { EntityId } from "@mtg-forge-ts/core";
import type { EngineYield } from "../../action/engine-yield.js";
import type { Game } from "../../game.js";
import { effectRegistry } from "../effect-registry.js";
import { evaluateParamRaw, hasParam } from "../evaluate-param.js";
import { SpellAbilityEffect } from "../spell-ability-effect.js";
import type { SpellAbility } from "../spell-ability.js";

/** Collect all card ids on the battlefield matching the ValidCards$ filter. */
function collectMatching(sa: SpellAbility, game: Game): EntityId[] {
  const filterRaw = hasParam(sa, "ValidCards") ? evaluateParamRaw(sa, "ValidCards") : "Creature";
  const tokens = filterRaw.split(".").map((t) => t.trim().toLowerCase());
  const baseType = tokens[0] ?? "creature";
  const qualifier = tokens[1] ?? "";

  const matched: EntityId[] = [];
  for (const [id, card] of game.cards) {
    // Use layerEngine for type-awareness (animate effects, etc.)
    const chars = game.layerEngine.computeCharacteristics(id);

    // Base-type filter.
    if (baseType !== "permanent") {
      if (baseType === "creature" && !chars.types.has(CardType.Creature)) continue;
      if (baseType === "artifact" && !chars.types.has(CardType.Artifact)) continue;
      if (baseType === "enchantment" && !chars.types.has(CardType.Enchantment)) continue;
      if (baseType === "land" && !chars.types.has(CardType.Land)) continue;
    }

    // Controller qualifier.
    if (qualifier === "youctrl" && card.controllerSeat !== sa.controllerSeat) continue;
    if (qualifier === "opponentctrl" && card.controllerSeat === sa.controllerSeat) continue;

    matched.push(id);
  }
  return matched;
}

export class DestroyAllEffect extends SpellAbilityEffect {
  static override readonly handlerKey = "DestroyAll";

  override *resolve(sa: SpellAbility, game: Game): Generator<EngineYield, void, unknown> {
    // Collect targets first (simultaneous destroy semantics, CR 700.7).
    const targets = collectMatching(sa, game);

    for (const cardId of targets) {
      yield* game.action.destroy(cardId, { sourceId: sa.sourceCardId, cause: "effect" });
    }
  }
}

effectRegistry.register(DestroyAllEffect);
