// SPDX-License-Identifier: GPL-3.0-or-later
// AdaptKeywordHandler — processes K:Adapt:N:<cost> keyword lines (Ravnica
// Allegiance; CR 702.139) and synthesizes a battlefield-zone activated
// SpellAbility on the creature.
//
// CR 702.139a — "Adapt N — [cost]": "[Cost]: If this creature has no
// +1/+1 counters on it, put N +1/+1 counters on it." The keyword line
// stores N in `params.amount` and the activation cost in `params.cost`
// (TWO_PARAM_KEYWORDS — see keyword-line.ts).
//
// MVP scope:
//   1. Add "adapt" to card.keywords.
//   2. Synthesize an activated SpellAbility with handlerKey "Adapt"
//      and the cost from the keyword line. The handler is a small
//      AdaptEffect (resolves Defined$ Self, conditional check on
//      +1/+1 counters, addCounter via the standard action layer).
//   3. The +1/+1 counter "no counters" precondition is read at
//      RESOLUTION time inside AdaptEffect (CR 603.4 — checked when the
//      ability resolves, not when it goes on the stack).
import type { KeywordAst, ParamValue, SVarAst } from "@mtg-forge-ts/core";
import { ZoneType } from "@mtg-forge-ts/core";
import { SpellAbility } from "../../ability/spell-ability.js";
import { keywordHandlerRegistry } from "../keyword-handler-registry.js";
import type { KeywordActivationContext } from "../keyword-handler.js";
import { KeywordHandler } from "../keyword-handler.js";

export class AdaptKeywordHandler extends KeywordHandler {
  static override readonly keyword = "adapt" as const;

  override activate(ast: KeywordAst, ctx: KeywordActivationContext): void {
    const card = ctx.game.cards.get(ctx.sourceCardId);
    if (!card) return;

    if (!card.keywords) card.keywords = new Set();
    card.keywords.add("adapt");

    const amountParam = ast.params?.amount as ParamValue | undefined;
    const costParam = ast.params?.cost as ParamValue | undefined;
    const adaptN = amountParam && amountParam.kind === "literal" ? (amountParam.raw as string) : "1";
    const adaptCost = costParam && costParam.kind === "literal" ? (costParam.raw as string) : "0";

    const fakeAst = {
      kind: "activated" as const,
      effect: {
        handlerKey: "Adapt",
        params: {
          AdaptN: { kind: "literal" as const, raw: adaptN },
        },
      },
      cost: { raw: adaptCost },
      rulesText: `Adapt ${adaptN} — {${adaptCost}}: If this creature has no +1/+1 counters on it, put ${adaptN} +1/+1 counters on it.`,
    };

    const def = card.paperCard.definition;
    const svars = (def?.svars as ReadonlyMap<string, SVarAst>) ?? new Map<string, SVarAst>();
    const sa = new SpellAbility(
      fakeAst,
      ctx.sourceCardId,
      ctx.controllerSeat,
      svars,
      [],
      undefined,
      new Set([ZoneType.Battlefield]),
      new Set(["adapt"]),
    );
    card.spellAbilities.push(sa);
  }

  override deactivate(_ast: KeywordAst, ctx: KeywordActivationContext): void {
    const card = ctx.game.cards.get(ctx.sourceCardId);
    card?.keywords?.delete("adapt");
  }
}

keywordHandlerRegistry.register(AdaptKeywordHandler);
