// SPDX-License-Identifier: GPL-3.0-or-later
// FogEffect — Forge `SP$ Fog`: prevent all combat damage that would be
// dealt this turn. Registers a ReplacementAbility that intercepts every
// combat-damage intent for the rest of the turn and reduces it to 0
// (returns null to fully prevent). Self-unregisters at end of turn via
// a TurnEnded subscription on the registered closure.
//
// Forge DSL: A:SP$ Fog | SpellDescription$ Prevent all combat damage ...
//
// MVP scope: prevention is unconditional for the rest of the turn. Forge
// supports more granular forms (ValidCard$, ValidPlayer$ filters) — those
// are deferred to a follow-up wave; the canonical Fog (Constant Mists,
// Holy Day, Moment's Peace) needs no filter.
import type { EntityId, MutationIntent, ReplacementAbility } from "@mtg-forge-ts/core";
import { ZoneType } from "@mtg-forge-ts/core";
import type { EngineYield } from "../../action/engine-yield.js";
import type { Game } from "../../game.js";
import type { DamageIntent } from "../../replacements/mutation-intent.js";
import { effectRegistry } from "../effect-registry.js";
import { SpellAbilityEffect } from "../spell-ability-effect.js";
import type { SpellAbility } from "../spell-ability.js";

export class FogEffect extends SpellAbilityEffect {
  static override readonly handlerKey = "Fog";

  override *resolve(sa: SpellAbility, game: Game): Generator<EngineYield, void, unknown> {
    const replacementId: EntityId = game.newEntityId();
    const turnAtRegistration = game.turn;

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
        if (intent.kind !== "damage") return false;
        const di = intent as unknown as DamageIntent;
        return di.isCombat === true;
      },
      apply(_intent: MutationIntent, _game: unknown): MutationIntent | null {
        // Fully prevent — return null to drop the intent.
        return null;
      },
    };

    game.replacementRegistry.register(replacement);

    // Auto-unregister at end of the current turn. We watch TurnEnded events;
    // the registry walks subscribers per emitEvent so the unregister fires
    // before the next turn's combat damage can flow.
    const expiryHook = (): void => {
      game.replacementRegistry.unregister(replacementId);
    };
    // Mirror prevent-damage's pattern: register a one-shot delayed trigger
    // observing TurnEnded for the registration turn.
    const dtId = game.newEntityId();
    game.delayedTriggerQueue.add({
      id: dtId,
      kind: "triggered",
      sourceCardId: sa.sourceCardId,
      activeInZones: new Set([ZoneType.Battlefield, ZoneType.Stack, ZoneType.Graveyard]),
      timestamp: 0,
      controllerSeatAtReg: sa.controllerSeat,
      isDelayed: true,
      createdAtTurn: turnAtRegistration,
      creationContext: {},
      oneShot: true,
      matches(event) {
        if (event.kind !== "TurnEnded") return false;
        // Run cleanup eagerly — see EffectEffect.ExileOnMoved for prior art.
        expiryHook();
        return true;
      },
    });
  }
}

effectRegistry.register(FogEffect);
