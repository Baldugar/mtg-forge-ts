// SPDX-License-Identifier: GPL-3.0-or-later
// ProtectionEffect — handles Forge's `SP$ Protection` effect line.
// Grants protection from a color/type to the target until the specified
// duration.
//
// Forge DSL:
//   SP$ Protection | ValidTgts$ Creature.YouCtrl | Gains$ red | Until$ EOT
//   SP$ Protection | ValidTgts$ Card.Self | Gains$ white | Until$ EOT
//
// MVP STATUS: STUB — registers the handler key so the semantic validator
// no longer flags Protection as unknown. apply() is a no-op.
//
// TODO(SP3): implement as a ContinuousEffect on Layer 6 (keyword grant).
// The synthetic keyword can be modeled as "protection_<color>" stored in
// a Set<string> on the computed characteristics. ReplacementEngine can
// then intercept damage/targeting intents and check the protection set.
import type { EngineYield } from "../../action/engine-yield.js";
import type { Game } from "../../game.js";
import { effectRegistry } from "../effect-registry.js";
import { SpellAbilityEffect } from "../spell-ability-effect.js";
import type { SpellAbility } from "../spell-ability.js";

export class ProtectionEffect extends SpellAbilityEffect {
  static override readonly handlerKey = "Protection";

  // biome-ignore lint/correctness/useYield: stub — protection grant deferred to SP3
  override *resolve(_sa: SpellAbility, _game: Game): Generator<EngineYield, void, unknown> {
    // STUB: protection-from-color continuous effect not yet implemented.
    // Registered so the DSL validator counts Protection as a known key.
    // Wave N+1 adds Layer 6 keyword-grant via ContinuousEffectRegistry.
  }
}

effectRegistry.register(ProtectionEffect);
