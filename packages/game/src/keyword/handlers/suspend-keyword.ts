// SPDX-License-Identifier: GPL-3.0-or-later
// SuspendKeywordHandler — processes K:Suspend:N:cost keyword lines (Time
// Spiral, CR 702.61) and synthesizes a hand-zone activated SpellAbility.
//
// CR 702.61 — "Suspend N — [cost]" is a special action: rather than casting
// the card, the player exiles it from their hand with N time counters; the
// player pays the suspend cost. At the beginning of each of that player's
// upkeeps, remove a time counter; when the last is removed, cast the card
// without paying its mana cost (and the spell gains haste until the player
// lets go of it).
//
// DSL form:
//   K:Suspend:3:1 R    → 3 time counters, suspend cost {1}{R}
//
// This handler:
//   1. Adds "suspend" to card.keywords (flag awareness for other systems).
//   2. Reads `params.amount` (the time-counter count) and `params.cost`
//      (the suspend mana cost) from the AST.
//   3. Synthesizes an AbilityAst whose effect is "Suspend" (resolves via
//      SuspendEffect) and whose cost is the suspend mana cost. The
//      time-counter count is threaded through `effect.params.SuspendCount`.
//   4. Wraps it in a SpellAbility active in {Hand} only, tagged "suspend"
//      and "sorcery-speed". Pushes it onto card.spellAbilities.
//
// Pairing:
//   - Free-cast arm: see altcost/suspend.ts. Activates when
//     card.suspendedCounters === 0 in the Exile zone.
//   - Upkeep tick: tickSuspendedCards() (suspend-tick.ts) decrements
//     suspendedCounters by 1 on each of the controller's upkeeps.
import type { KeywordAst, ParamValue, SVarAst } from "@mtg-forge-ts/core";
import { ZoneType } from "@mtg-forge-ts/core";
import { SpellAbility } from "../../ability/spell-ability.js";
import { keywordHandlerRegistry } from "../keyword-handler-registry.js";
import type { KeywordActivationContext } from "../keyword-handler.js";
import { KeywordHandler } from "../keyword-handler.js";

export class SuspendKeywordHandler extends KeywordHandler {
  static override readonly keyword = "suspend" as const;

  override activate(ast: KeywordAst, ctx: KeywordActivationContext): void {
    const card = ctx.game.cards.get(ctx.sourceCardId);
    if (!card) return;

    // 1. Flag set bookkeeping for hasKeyword("suspend").
    if (!card.keywords) card.keywords = new Set();
    card.keywords.add("suspend");

    // 2. Pull params: amount (N) and cost. amount is the time-counter count.
    const amountParam = ast.params?.amount as ParamValue | undefined;
    const costParam = ast.params?.cost as ParamValue | undefined;
    const nRaw = amountParam && amountParam.kind === "literal" ? (amountParam.raw as string) : "0";
    const costRaw = costParam && costParam.kind === "literal" ? (costParam.raw as string) : "0";

    // 3. Synthetic AbilityAst: Suspend special action.
    const fakeAst = {
      kind: "activated" as const,
      effect: {
        handlerKey: "Suspend",
        params: {
          SuspendCount: { kind: "literal" as const, raw: nRaw },
        },
      },
      cost: { raw: costRaw },
      rulesText: `Suspend ${nRaw} — {${costRaw}}: exile this card from your hand with ${nRaw} time counters; cast it for free when the last is removed.`,
    };

    // 4. Synthesize the SpellAbility, active only in Hand, sorcery-speed
    //    gated (special action; main phase + empty stack).
    const def = card.paperCard.definition;
    const svars = (def?.svars as ReadonlyMap<string, SVarAst>) ?? new Map<string, SVarAst>();
    const sa = new SpellAbility(
      fakeAst,
      ctx.sourceCardId,
      ctx.controllerSeat,
      svars,
      [],
      undefined,
      new Set([ZoneType.Hand]),
      new Set(["suspend", "sorcery-speed"]),
    );

    card.spellAbilities.push(sa);
  }

  override deactivate(_ast: KeywordAst, ctx: KeywordActivationContext): void {
    const card = ctx.game.cards.get(ctx.sourceCardId);
    if (!card) return;
    card.keywords?.delete("suspend");
  }
}

keywordHandlerRegistry.register(SuspendKeywordHandler);
