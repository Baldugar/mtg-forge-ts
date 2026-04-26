// SPDX-License-Identifier: GPL-3.0-or-later
// SuspendEffect — resolution side of the Suspend special action (CR 702.61).
//
// CR 702.61a — "Suspend [N] [cost]" is a special action: the player exiles
// this card from their hand with N time counters on it; the player pays the
// suspend cost. At the beginning of each of that player's upkeeps, remove a
// time counter; when the last is removed, the player casts the card without
// paying its mana cost (and the spell gains haste until the player lets go
// of it).
//
// Resolution responsibilities:
//   1. Move source card from Hand to (shared) Exile face-up.
//   2. Stamp `card.suspendedCounters = N` (read off the keyword AST by the
//      synthesizing keyword handler and propagated via SuspendCount param).
//   3. Emit a CardSuspended-like event using the available Exiled +
//      generic CardChangedZone signals already produced by exile().
//      (Wave 26 MVP — no dedicated SuspendCast event; tests assert on the
//      flag stamp + later free-cast.)
import type { EngineYield } from "../../action/engine-yield.js";
import type { Game } from "../../game.js";
import { effectRegistry } from "../effect-registry.js";
import { evaluateParamNumber } from "../evaluate-param.js";
import { SpellAbilityEffect } from "../spell-ability-effect.js";
import type { SpellAbility } from "../spell-ability.js";

export class SuspendEffect extends SpellAbilityEffect {
  static override readonly handlerKey = "Suspend";

  override *resolve(sa: SpellAbility, game: Game): Generator<EngineYield, void, unknown> {
    const card = game.cards.get(sa.sourceCardId);
    if (!card) return;

    const n = evaluateParamNumber(sa, "SuspendCount", game);

    // 1. Move source from its origin zone (typically Hand) to shared Exile.
    yield* game.action.exile(sa.sourceCardId, { sourceId: sa.sourceCardId });

    // 2. Stamp the suspended-counter count.
    card.suspendedCounters = Math.max(0, n);
  }
}

effectRegistry.register(SuspendEffect);
