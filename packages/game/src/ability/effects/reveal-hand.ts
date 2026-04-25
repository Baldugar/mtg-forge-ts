// SPDX-License-Identifier: GPL-3.0-or-later
// RevealHandEffect — handles Forge's `SP$ RevealHand` effect line.
// Reveals the hand of a target player to all players.
//
// Forge DSL:
//   SP$ RevealHand | Defined$ Player.Opponent
//   SP$ RevealHand | Defined$ Targeted
//
// MVP STATUS: STUB — no-op (does not emit events or request decisions). The
// full implementation requires a "revealCards" event and an interactive
// look-at decision; both are deferred to SP3. Registered so the semantic
// validator no longer flags RevealHand as an unknown handler key.
//
// TODO(SP3): look up the target player's hand zone, emit a CardsRevealed
// event (or the equivalent), and optionally yield a lookAtCards decision
// for each opponent so they see the revealed cards.
import type { EngineYield } from "../../action/engine-yield.js";
import type { Game } from "../../game.js";
import { effectRegistry } from "../effect-registry.js";
import { SpellAbilityEffect } from "../spell-ability-effect.js";
import type { SpellAbility } from "../spell-ability.js";

export class RevealHandEffect extends SpellAbilityEffect {
  static override readonly handlerKey = "RevealHand";

  // biome-ignore lint/correctness/useYield: stub — no yield points; reveal event deferred to SP3
  override *resolve(_sa: SpellAbility, _game: Game): Generator<EngineYield, void, unknown> {
    // Stub — full reveal-hand event and look-at decision deferred to SP3.
    // No-op so invoking this handler does not crash the game engine.
    return;
  }
}

effectRegistry.register(RevealHandEffect);
