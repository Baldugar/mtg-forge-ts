// SPDX-License-Identifier: GPL-3.0-or-later
// PeekAndRevealEffect — look at the top N cards of a player's library and
// reveal them to all players.
//
// Forge DSL:
//   SP$ PeekAndReveal | Defined$ Player.Opponent | NumCards$ 1
//   SP$ PeekAndReveal | Defined$ Targeted | NumCards$ 3
//
// MVP STATUS: STUB — full implementation requires a reveal event kind in
// core/events and interactive "look at" decision support. Both are deferred
// to Wave 9.
//
// The handler is registered so the semantic validator stops flagging
// "PeekAndReveal" as an unknown handler key. resolve() is a no-op stub
// that does not crash.
//
// TODO(Wave 9): emit a "CardsRevealed" event from the action pipeline;
// add a "lookAtCards" decision yield; implement the peek + optional
// selection sub-effects (some cards let you put them in a specific order).
import type { EngineYield } from "../../action/engine-yield.js";
import type { Game } from "../../game.js";
import { effectRegistry } from "../effect-registry.js";
import { SpellAbilityEffect } from "../spell-ability-effect.js";
import type { SpellAbility } from "../spell-ability.js";

export class PeekAndRevealEffect extends SpellAbilityEffect {
  static override readonly handlerKey = "PeekAndReveal";

  // biome-ignore lint/correctness/useYield: stub — no yield points; return early is intentional
  override *resolve(_sa: SpellAbility, _game: Game): Generator<EngineYield, void, unknown> {
    // Stub — reveal event and look-at decision deferred to Wave 9.
    // No-op so invoking this handler doesn't crash the game engine.
    return;
  }
}

effectRegistry.register(PeekAndRevealEffect);
