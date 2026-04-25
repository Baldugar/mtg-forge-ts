// SPDX-License-Identifier: GPL-3.0-or-later
// RollDiceEffect — handles Forge's `SP$ RollDice` effect line.
// Rolls N dice with M sides and passes the result to a ResultSubAbility.
//
// Forge DSL:
//   SP$ RollDice | NumSides$ 6 | NumDice$ 1 | ResultSubAbility$ DBCheck
//   SP$ RollDice | NumSides$ 20 | NumDice$ 1 | ResultSubAbility$ DBResult
//
// MVP STATUS: STUB — deterministic roll (always yields 1 per die). The
// ResultSubAbility SVar dispatch is not wired. Registered so the semantic
// validator no longer flags RollDice as an unknown effect key.
//
// TODO(SP3): use game.rng.rollDice(sides) when the RNG surface is added.
// Wire ResultSubAbility via the SVar pipeline (same pattern as Charm/Effect).
// The total result should be stored in xValue so condition-checks can use it.
import type { EngineYield } from "../../action/engine-yield.js";
import type { Game } from "../../game.js";
import { effectRegistry } from "../effect-registry.js";
import { SpellAbilityEffect } from "../spell-ability-effect.js";
import type { SpellAbility } from "../spell-ability.js";

export class RollDiceEffect extends SpellAbilityEffect {
  static override readonly handlerKey = "RollDice";

  // biome-ignore lint/correctness/useYield: stub — dice roll + sub-ability dispatch deferred
  override *resolve(_sa: SpellAbility, _game: Game): Generator<EngineYield, void, unknown> {
    // STUB: dice roll is deterministic (always 1) and ResultSubAbility is not
    // dispatched. Registered so DSL validator counts RollDice as a known key.
    // Wave N+1 adds game.rng.rollDice(sides) and SVar sub-ability dispatch.
  }
}

effectRegistry.register(RollDiceEffect);
