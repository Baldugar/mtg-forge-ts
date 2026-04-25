// SPDX-License-Identifier: GPL-3.0-or-later
// PlayEffect — cast a target card from any zone (graveyard, hand, exile, etc.),
// optionally without paying its mana cost.
//
// Forge DSL:
//   SP$ Play | Defined$ Targeted | Optional$ True | WithoutManaCost$ True
//   SP$ Play | Defined$ Remembered | WithoutManaCost$ True
//
// MVP STATUS: STUB — full implementation requires integration with the cast
// pipeline (SpellAbility stack-push, cost substitution, Defined$ resolution
// for non-hand zones). This is deferred to Wave 9 when the cast pipeline is
// fully wired.
//
// The handler is registered so the semantic validator stops flagging "Play"
// as an unknown handler key. resolve() throws an informative error so
// developers know this is not silently no-oping.
//
// TODO(Wave 9): wire Defined$ → card lookup, WithoutManaCost$ → cost
// substitution, cast the card via game.action.castFromZone(cardId, { free }).
import type { EngineYield } from "../../action/engine-yield.js";
import type { Game } from "../../game.js";
import { effectRegistry } from "../effect-registry.js";
import { SpellAbilityEffect } from "../spell-ability-effect.js";
import type { SpellAbility } from "../spell-ability.js";

export class PlayEffect extends SpellAbilityEffect {
  static override readonly handlerKey = "Play";

  // biome-ignore lint/correctness/useYield: stub — no yield points; return early is intentional
  override *resolve(_sa: SpellAbility, _game: Game): Generator<EngineYield, void, unknown> {
    // Stub — runtime not yet wired. Deferred to Wave 9.
    // Uncomment and fill once cast pipeline supports free-cast from arbitrary zones:
    // throw new Error("PlayEffect runtime not yet wired (deferred to Wave 9)");
    // For now: no-op so tests that invoke this don't crash games.
    return;
  }
}

effectRegistry.register(PlayEffect);
