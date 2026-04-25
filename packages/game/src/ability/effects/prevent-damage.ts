// SPDX-License-Identifier: GPL-3.0-or-later
// PreventDamageEffect — registers a temporary DamageReplacement that intercepts
// incoming damage to the target player and consumes a shield.
//
// Forge DSL:
//   SP$ PreventDamage | ValidTarget$ You | Amount$ 5
//   SP$ PreventDamage | ValidTarget$ Opponent | Amount$ 3
//
// Forge `ValidTarget$` values mapped here:
//   You / YouCtrl  → sa.controllerSeat
//   Opponent       → the other seat (2-player assumption for MVP)
//   (absent)       → defaults to You
//
// When PreventDamage N resolves, a ReplacementAbility is registered that:
//   - matches damage intents targeting the specified player
//   - reduces the damage amount up to the remaining shield
//   - unregisters itself when the shield is fully consumed
import type { EntityId, MutationIntent, PlayerSeat, ReplacementAbility } from "@mtg-forge-ts/core";
import { ZoneType, mkPlayerSeat } from "@mtg-forge-ts/core";
import type { EngineYield } from "../../action/engine-yield.js";
import type { Game } from "../../game.js";
import type { DamageIntent } from "../../replacements/mutation-intent.js";
import { effectRegistry } from "../effect-registry.js";
import { evaluateParamNumber, evaluateParamRaw, hasParam } from "../evaluate-param.js";
import { SpellAbilityEffect } from "../spell-ability-effect.js";
import type { SpellAbility } from "../spell-ability.js";

export class PreventDamageEffect extends SpellAbilityEffect {
  static override readonly handlerKey = "PreventDamage";

  override *resolve(sa: SpellAbility, game: Game): Generator<EngineYield, void, unknown> {
    const amount = evaluateParamNumber(sa, "Amount", game);
    const targetRaw = hasParam(sa, "ValidTarget") ? evaluateParamRaw(sa, "ValidTarget") : "You";
    const controllerNum = sa.controllerSeat as unknown as number;
    let seat: PlayerSeat;
    if (targetRaw === "Opponent") {
      // 2-player assumption: the opponent is whichever seat is not the controller.
      seat = mkPlayerSeat(controllerNum === 0 ? 1 : 0);
    } else {
      // You / YouCtrl / default
      seat = sa.controllerSeat;
    }

    // Also update the legacy field so tests that check damagePreventionShield
    // still pass — the replacement consumes the real shield logic below.
    const player = game.getPlayer(seat);
    player.damagePreventionShield = (player.damagePreventionShield ?? 0) + amount;

    // Closure-tracked shield; decremented as damage events are prevented.
    let shield = amount;
    const replacementId: EntityId = game.newEntityId();

    const replacement: ReplacementAbility = {
      id: replacementId,
      kind: "replacement",
      sourceCardId: sa.sourceCardId,
      activeInZones: new Set([ZoneType.Battlefield, ZoneType.Stack]) as ReadonlySet<ZoneType>,
      timestamp: game.newEntityId(),
      controllerSeatAtReg: sa.controllerSeat,
      isSelfReplacement: false,
      layer: "other",
      matches(intent: MutationIntent): boolean {
        if (shield <= 0) return false;
        if (intent.kind !== "damage") return false;
        const di = intent as DamageIntent;
        if (di.targetKind !== "player") return false;
        return (di.targetId as unknown as number) === (seat as unknown as number);
      },
      apply(intent: MutationIntent, _gameArg: unknown): MutationIntent | null {
        const di = intent as DamageIntent;
        const reduction = Math.min(shield, di.amount);
        shield -= reduction;
        // Keep legacy field in sync with closure-tracked shield.
        const p = game.getPlayer(seat);
        if (p.damagePreventionShield !== undefined) {
          p.damagePreventionShield = Math.max(0, p.damagePreventionShield - reduction);
        }
        if (shield <= 0) {
          game.replacementRegistry.unregister(replacementId);
        }
        const newAmount = di.amount - reduction;
        if (newAmount === 0) return null; // fully prevented
        return { ...intent, amount: newAmount } as unknown as MutationIntent;
      },
    };

    game.replacementRegistry.register(replacement);
  }
}

effectRegistry.register(PreventDamageEffect);
