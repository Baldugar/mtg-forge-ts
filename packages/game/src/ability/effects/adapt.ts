// SPDX-License-Identifier: GPL-3.0-or-later
// AdaptEffect — resolves the synthesized Adapt activated ability
// (CR 702.139). Synthesized by AdaptKeywordHandler on a creature with
// K:Adapt:N:<cost>; runs once the activated ability resolves off the
// stack.
//
// Resolution sequence:
//   1. Read AdaptN from sa.ast.effect.params.AdaptN (set by the keyword
//      handler at synthesis time).
//   2. Look up self via sa.sourceCardId.
//   3. CR 702.139a precondition: "if this creature has no +1/+1
//      counters on it." If self.counters[+1/+1] > 0 the ability has no
//      effect (Forge parity — the ability still resolves, just no-ops).
//   4. Otherwise, addCounter(self, +1/+1, AdaptN, sourceCardId=self).
import { CounterType, mkEvent } from "@mtg-forge-ts/core";
import type { EngineYield } from "../../action/engine-yield.js";
import type { Game } from "../../game.js";
import { effectRegistry } from "../effect-registry.js";
import { evaluateParamNumber } from "../evaluate-param.js";
import { SpellAbilityEffect } from "../spell-ability-effect.js";
import type { SpellAbility } from "../spell-ability.js";

export class AdaptEffect extends SpellAbilityEffect {
  static override readonly handlerKey = "Adapt";
  override *resolve(sa: SpellAbility, game: Game): Generator<EngineYield, void, unknown> {
    const n = evaluateParamNumber(sa, "AdaptN", game);
    const self = game.cards.get(sa.sourceCardId);
    if (!self) return;
    const existing = self.counters?.get(CounterType.PlusOnePlusOne) ?? 0;
    if (existing > 0) return; // CR 702.139a precondition fails — no-op.
    yield* game.action.addCounter(sa.sourceCardId, CounterType.PlusOnePlusOne, n, sa.sourceCardId);
    // Wave 70.A — emit CardAdapted pulse so Mode$ Adapted triggers can
    // distinguish Adapt resolution from generic +1/+1 counter additions.
    yield game.emitEvent(
      mkEvent("CardAdapted", game.turn, game.phase, {
        cardId: sa.sourceCardId,
        amount: n,
      }),
    );
  }
}

effectRegistry.register(AdaptEffect);
