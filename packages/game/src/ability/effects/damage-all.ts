// SPDX-License-Identifier: GPL-3.0-or-later
// DamageAllEffect — deals NumDmg damage to all permanents matching ValidCards$.
// Pyroclasm, Earthquake, Inferno, etc. (31 cards in corpus).
//
// Forge DSL:
//   SP$ DamageAll | Cost$ 2 R | NumDmg$ 2 | ValidCards$ Creature
//   SP$ DamageAll | Cost$ X R | NumDmg$ X | ValidCards$ Creature
//
// Supported ValidCards$ filter tokens (MVP — same set as DestroyAll):
//   Creature            — any Creature on battlefield
//   Creature.YouCtrl    — Creature controlled by sa.controllerSeat
//   Creature.OpponentCtrl — Creature NOT controlled by sa.controllerSeat
//   Artifact            — any Artifact on battlefield
//   Enchantment         — any Enchantment on battlefield
//   Land                — any Land on battlefield
//   Permanent           — any permanent on battlefield
//
// ValidPlayers$ Each (also damage players) is deferred to a later wave.
//
// Cards are collected first, then damage is dealt to all simultaneously
// per CR 700.7; SBAs afterwards clean up creatures with lethal damage.
import { CardType } from "@mtg-forge-ts/core";
import type { EntityId } from "@mtg-forge-ts/core";
import type { EngineYield } from "../../action/engine-yield.js";
import type { Game } from "../../game.js";
import { effectRegistry } from "../effect-registry.js";
import { evaluateParamNumber, evaluateParamRaw, hasParam } from "../evaluate-param.js";
import { SpellAbilityEffect } from "../spell-ability-effect.js";
import type { SpellAbility } from "../spell-ability.js";

/** Collect all card ids matching the ValidCards$ filter. */
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

export class DamageAllEffect extends SpellAbilityEffect {
  static override readonly handlerKey = "DamageAll";

  override *resolve(sa: SpellAbility, game: Game): Generator<EngineYield, void, unknown> {
    const amount = evaluateParamNumber(sa, "NumDmg", game);
    // Collect targets first (simultaneous damage semantics, CR 700.7).
    const targets = collectMatching(sa, game);

    for (const cardId of targets) {
      yield* game.action.damage(sa.sourceCardId, "creature", cardId, amount, false);
    }
  }
}

effectRegistry.register(DamageAllEffect);
