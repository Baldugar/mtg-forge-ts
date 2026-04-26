// SPDX-License-Identifier: GPL-3.0-or-later
// OutlastKeywordHandler — processes K:Outlast:<cost> keyword lines
// (Khans of Tarkir, CR 702.122) and synthesizes a Battlefield-zone
// activated SpellAbility on the card.
//
// CR 702.122a — "Outlast [cost]" — "[cost], {T}: Put a +1/+1 counter on
// this creature. Activate this ability only as a sorcery."
//
// DSL form:
//   K:Outlast:W       → cost = "W"
//   K:Outlast:1 G     → cost = "1 G"
//
// MVP scope:
//   1. Adds "outlast" to card.keywords.
//   2. Synthesizes a Battlefield-zone, sorcery-speed SpellAbility with
//      cost `<cost>, T` and handlerKey "PutCounter". The PutCounter
//      effect (Wave 4) reads CounterType + CounterNum from sa.params and
//      stamps the counters on `Defined$ Self`.
import type { KeywordAst, ParamValue, SVarAst } from "@mtg-forge-ts/core";
import { ZoneType } from "@mtg-forge-ts/core";
import { SpellAbility } from "../../ability/spell-ability.js";
import { keywordHandlerRegistry } from "../keyword-handler-registry.js";
import type { KeywordActivationContext } from "../keyword-handler.js";
import { KeywordHandler } from "../keyword-handler.js";

export class OutlastKeywordHandler extends KeywordHandler {
  static override readonly keyword = "outlast" as const;

  override activate(ast: KeywordAst, ctx: KeywordActivationContext): void {
    const card = ctx.game.cards.get(ctx.sourceCardId);
    if (!card) return;

    if (!card.keywords) card.keywords = new Set();
    card.keywords.add("outlast");

    const costParam = ast.params?.cost as ParamValue | undefined;
    const outlastCost = costParam && costParam.kind === "literal" ? (costParam.raw as string) : "0";

    const fakeAst = {
      kind: "activated" as const,
      effect: {
        handlerKey: "PutCounter",
        params: {
          Defined: { kind: "literal" as const, raw: "Self" },
          CounterType: { kind: "literal" as const, raw: "P1P1" },
          CounterNum: { kind: "literal" as const, raw: "1" },
        },
      },
      cost: { raw: `${outlastCost}, T` },
      rulesText: `Outlast ${outlastCost} — ${outlastCost}, {T}: Put a +1/+1 counter on this creature. Activate only as a sorcery.`,
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
      new Set(["outlast", "sorcery_speed"]),
    );

    card.spellAbilities.push(sa);
  }

  override deactivate(_ast: KeywordAst, ctx: KeywordActivationContext): void {
    const card = ctx.game.cards.get(ctx.sourceCardId);
    card?.keywords?.delete("outlast");
  }
}

keywordHandlerRegistry.register(OutlastKeywordHandler);
