// SPDX-License-Identifier: GPL-3.0-or-later
// BloodthirstKeywordHandler — processes K:Bloodthirst:N keyword lines
// (Guildpact, CR 702.53) and stamps a static `etbCounterSpec` so the
// counters are placed during the CR 614 replacement-effect application
// path inside `applyEtbStamping`. Mirrors Forge's static-replacement
// model (no stack-going trigger, no AbilityActivated emission).
//
// CR 702.53a — "Bloodthirst N" — "If an opponent was dealt damage this
// turn, this creature enters with N +1/+1 counters on it."
// CR 702.53b — "Bloodthirst X" — X equals the amount of damage dealt
// to opponents this turn.
//
// DSL form:
//   K:Bloodthirst:1     → N = 1
//   K:Bloodthirst:3     → N = 3
//   K:Bloodthirst:X     → variable; resolves at apply-time to
//                         max(opponent.lifeLostThisTurn).
//
// M6.26 — converted from triggered ability to static replacement.
// `applyEtbStamping` reads `card.etbCounterSpecs` entries with
// `condition: "bloodthirst"` and gates on `flags.lifeLostThisTurn` for
// any opponent. Closes the divergence where the TS engine emitted a
// stack-going trigger (AbilityActivated + StackItemResolved) for an
// effect Forge models as silent CR 614 application.
import type { CounterType, KeywordAst, ParamValue } from "@mtg-forge-ts/core";
import { CounterType as CT } from "@mtg-forge-ts/core";
import { keywordHandlerRegistry } from "../keyword-handler-registry.js";
import type { KeywordActivationContext } from "../keyword-handler.js";
import { KeywordHandler } from "../keyword-handler.js";

export class BloodthirstKeywordHandler extends KeywordHandler {
  static override readonly keyword = "bloodthirst" as const;

  override activate(ast: KeywordAst, ctx: KeywordActivationContext): void {
    const card = ctx.game.cards.get(ctx.sourceCardId);
    if (!card) return;

    if (!card.keywords) card.keywords = new Set();
    card.keywords.add("bloodthirst");

    const amountParam = ast.params?.amount as ParamValue | undefined;
    const rawAmount = amountParam && amountParam.kind === "literal" ? (amountParam.raw as string) : "1";
    // K:Bloodthirst:X marker — when the amount literal is "X" (any case),
    // resolve N at apply-time as the max life-lost-this-turn across
    // opponents. Otherwise parse the literal at activate time.
    const isVariable = rawAmount.trim().toUpperCase() === "X";
    const literalN = Number.parseInt(rawAmount, 10);
    const fixedN = !isVariable && Number.isFinite(literalN) && literalN > 0 ? literalN : 1;

    const slot = card as unknown as {
      etbCounterSpecs?: Array<{
        readonly counterType: CounterType;
        readonly amount: number;
        readonly variable: boolean;
        readonly condition?: "bloodthirst";
      }>;
    };
    if (!slot.etbCounterSpecs) slot.etbCounterSpecs = [];
    slot.etbCounterSpecs.push({
      counterType: CT.PlusOnePlusOne,
      amount: fixedN,
      variable: isVariable,
      condition: "bloodthirst",
    });
  }

  override deactivate(_ast: KeywordAst, ctx: KeywordActivationContext): void {
    const card = ctx.game.cards.get(ctx.sourceCardId);
    if (!card) return;
    card.keywords?.delete("bloodthirst");
    // Filter out bloodthirst entries from etbCounterSpecs (other entries
    // — e.g. K:etbCounter — must persist for cards that combine both).
    const slot = card as unknown as {
      etbCounterSpecs?: Array<{
        readonly counterType: CounterType;
        readonly amount: number;
        readonly variable: boolean;
        readonly condition?: "bloodthirst";
      }>;
    };
    if (slot.etbCounterSpecs) {
      slot.etbCounterSpecs = slot.etbCounterSpecs.filter((s) => s.condition !== "bloodthirst");
    }
  }
}

keywordHandlerRegistry.register(BloodthirstKeywordHandler);
