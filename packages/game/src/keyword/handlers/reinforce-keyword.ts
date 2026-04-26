// SPDX-License-Identifier: GPL-3.0-or-later
// ReinforceKeywordHandler — processes K:Reinforce:<N>:<cost> keyword
// lines (Morningtide, CR 702.76) and synthesizes a Hand-zone activated
// SpellAbility on the card.
//
// CR 702.76a — "Reinforce N — [cost], Discard this card: Put N +1/+1
// counters on target creature."
//
// DSL form:
//   K:Reinforce:1:G        → N = 1, cost = "G"
//   K:Reinforce:3:1 G      → N = 3, cost = "1 G"
//
// MVP scope:
//   1. Adds "reinforce" to card.keywords.
//   2. Synthesizes a Hand-zone activated SpellAbility with cost
//      `<cost>, Discard CARDNAME` and handlerKey "Reinforce". The
//      ReinforceEffect resolver yields a chooseCard for a target
//      Creature on the battlefield, then stamps N +1/+1 counters on it.
import type { KeywordAst, ParamValue, SVarAst } from "@mtg-forge-ts/core";
import { ZoneType } from "@mtg-forge-ts/core";
import { SpellAbility } from "../../ability/spell-ability.js";
import { keywordHandlerRegistry } from "../keyword-handler-registry.js";
import type { KeywordActivationContext } from "../keyword-handler.js";
import { KeywordHandler } from "../keyword-handler.js";

export class ReinforceKeywordHandler extends KeywordHandler {
  static override readonly keyword = "reinforce" as const;

  override activate(ast: KeywordAst, ctx: KeywordActivationContext): void {
    const card = ctx.game.cards.get(ctx.sourceCardId);
    if (!card) return;

    if (!card.keywords) card.keywords = new Set();
    card.keywords.add("reinforce");

    const amountParam = ast.params?.amount as ParamValue | undefined;
    const amountRaw = amountParam && amountParam.kind === "literal" ? (amountParam.raw as string) : "1";
    const parsedN = Number.parseInt(amountRaw, 10);
    const safeN = Number.isFinite(parsedN) && parsedN > 0 ? parsedN : 1;

    const costParam = ast.params?.cost as ParamValue | undefined;
    const reinforceMana = costParam && costParam.kind === "literal" ? (costParam.raw as string) : "0";

    const fakeAst = {
      kind: "activated" as const,
      effect: {
        handlerKey: "Reinforce",
        params: {
          Amount: { kind: "literal" as const, raw: String(safeN) },
        },
      },
      cost: { raw: `${reinforceMana}, Discard CARDNAME` },
      rulesText: `Reinforce ${safeN}—${reinforceMana}, discard this card: Put ${safeN} +1/+1 counters on target creature.`,
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
      new Set([ZoneType.Hand]),
      new Set(["reinforce"]),
    );

    card.spellAbilities.push(sa);
  }

  override deactivate(_ast: KeywordAst, ctx: KeywordActivationContext): void {
    const card = ctx.game.cards.get(ctx.sourceCardId);
    card?.keywords?.delete("reinforce");
  }
}

keywordHandlerRegistry.register(ReinforceKeywordHandler);
