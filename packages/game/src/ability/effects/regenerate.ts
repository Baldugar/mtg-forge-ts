// SPDX-License-Identifier: GPL-3.0-or-later
// RegenerateEffect — grants a regeneration shield to a target creature.
// (26 cards in corpus: Regenerate, e.g. "G: Regenerate target creature.")
//
// Forge DSL:
//   AB$ Regenerate | Cost$ G | ValidTgts$ Creature.YouCtrl
//   AB$ Regenerate | Cost$ G | Defined$ Self
//
// Per CR 701.15, regeneration replaces the next destruction of the creature
// with: tap it, remove all damage from it, remove it from combat. This is a
// REPLACEMENT EFFECT that must intercept "Destroy" intents.
//
// MVP: set card.regenerationShields += 1. The ReplacementAbility that
// intercepts Destroy intents and consumes a shield is deferred to F2.
// The shield counter is the stable API that F2 will read.
//
// Targets: uses sa.targets (targeted variant). For "Defined$ Self", the
// calling pipeline is expected to have resolved Defined$ into sa.targets
// before dispatch. If sa.targets is empty, this is a no-op.
import type { EngineYield } from "../../action/engine-yield.js";
import type { Game } from "../../game.js";
import { effectRegistry } from "../effect-registry.js";
import { SpellAbilityEffect } from "../spell-ability-effect.js";
import type { SpellAbility } from "../spell-ability.js";

export class RegenerateEffect extends SpellAbilityEffect {
  static override readonly handlerKey = "Regenerate";

  // biome-ignore lint/correctness/useYield: shield increment is synchronous — no EngineYield to emit
  override *resolve(sa: SpellAbility, game: Game): Generator<EngineYield, void, unknown> {
    for (const targetId of sa.targets) {
      const card = game.cards.get(targetId);
      if (!card) continue;
      // Increment the shield counter. F2 will wire the ReplacementAbility
      // that intercepts Destroy intents and consumes one shield.
      card.regenerationShields += 1;
    }
  }
}

effectRegistry.register(RegenerateEffect);
