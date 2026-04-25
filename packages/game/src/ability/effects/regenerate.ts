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
// REPLACEMENT EFFECT that intercepts "Destroy" intents and consumes a shield.
//
// For each target, we register a single-charge ReplacementAbility. When the
// shield fires, it taps the creature, zeroes its damage, and prevents the
// destruction. When the shield is consumed the replacement self-unregisters.
//
// Targets: uses sa.targets (targeted variant). For "Defined$ Self", the
// calling pipeline is expected to have resolved Defined$ into sa.targets
// before dispatch. If sa.targets is empty, this is a no-op.
import type { EntityId, MutationIntent, ReplacementAbility } from "@mtg-forge-ts/core";
import { ZoneType } from "@mtg-forge-ts/core";
import type { EngineYield } from "../../action/engine-yield.js";
import type { Game } from "../../game.js";
import type { DestroyIntent } from "../../replacements/mutation-intent.js";
import { effectRegistry } from "../effect-registry.js";
import { SpellAbilityEffect } from "../spell-ability-effect.js";
import type { SpellAbility } from "../spell-ability.js";

export class RegenerateEffect extends SpellAbilityEffect {
  static override readonly handlerKey = "Regenerate";

  override *resolve(sa: SpellAbility, game: Game): Generator<EngineYield, void, unknown> {
    for (const targetId of sa.targets) {
      const card = game.cards.get(targetId);
      if (!card) continue;

      // Legacy field — still incremented so existing tests that check
      // regenerationShields remain green. The replacement consumes
      // one charge per destroy event rather than the integer counter.
      card.regenerationShields += 1;

      // One charge per Regenerate invocation.
      let shield = 1;
      const replacementId: EntityId = game.newEntityId();

      const replacement: ReplacementAbility = {
        id: replacementId,
        kind: "replacement",
        sourceCardId: sa.sourceCardId,
        activeInZones: new Set([ZoneType.Battlefield]) as ReadonlySet<ZoneType>,
        timestamp: game.newEntityId(),
        controllerSeatAtReg: sa.controllerSeat,
        isSelfReplacement: false,
        layer: "other",
        matches(intent: MutationIntent): boolean {
          if (shield <= 0) return false;
          if (intent.kind !== "destroy") return false;
          const di = intent as unknown as DestroyIntent;
          return di.cardId === targetId;
        },
        apply(_intent: MutationIntent, _gameArg: unknown): MutationIntent | null {
          shield -= 1;
          if (shield <= 0) {
            game.replacementRegistry.unregister(replacementId);
          }
          // CR 701.15: tap + remove all damage + remove from combat (MVP: tap + clear damage).
          const c = game.cards.get(targetId);
          if (c) {
            c.tapped = true;
            c.damage = 0;
            // Keep legacy counter in sync.
            if (c.regenerationShields > 0) c.regenerationShields -= 1;
          }
          // Return null to prevent the destruction.
          return null;
        },
      };

      game.replacementRegistry.register(replacement);
    }
  }
}

effectRegistry.register(RegenerateEffect);
