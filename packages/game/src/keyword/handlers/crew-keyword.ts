// SPDX-License-Identifier: GPL-3.0-or-later
// CrewKeywordHandler — processes K:Crew:N keyword lines and synthesizes a
// battlefield-zone activated SpellAbility on the Vehicle.
//
// CR 702.121 — Crew N: "Tap any number of untapped creatures you control
// with total power N or greater: This Vehicle becomes an artifact creature
// with its printed power and toughness until end of turn." The keyword line
// in Forge data takes the form `K:Crew:N` where N is the power threshold;
// the parser stores it on KeywordAst.params.amount (see keyword-line.ts —
// "crew" is in AMOUNT_KEYWORDS).
//
// This handler:
//   1. Adds "crew" to card.keywords (flag awareness for other systems).
//   2. Synthesizes an activated SpellAbility with handlerKey "Crew" and
//      empty cost — the creature-tap sequence is performed entirely INSIDE
//      CrewEffect.resolve as a yielded `chooseCrewSaddleCreatures` decision,
//      so we bypass the cost-payment infrastructure and do not need a
//      bespoke CostCrew cost-part.
//   3. Threads the threshold through `effect.params.CrewPower` as a literal
//      ParamValue so CrewEffect can read it via evaluateParamNumber.
//   4. Wraps the synthetic AST in a SpellAbility with activeInZones =
//      {Battlefield} and the "crew" tag.
//
// Deactivate clears the keyword flag; the synthesized SpellAbility stays on
// spellAbilities (mirrors cycling/specialize MVP cleanup deferral).
import type { KeywordAst, SVarAst } from "@mtg-forge-ts/core";
import { ZoneType } from "@mtg-forge-ts/core";
import { SpellAbility } from "../../ability/spell-ability.js";
import { keywordHandlerRegistry } from "../keyword-handler-registry.js";
import type { KeywordActivationContext } from "../keyword-handler.js";
import { KeywordHandler } from "../keyword-handler.js";

export class CrewKeywordHandler extends KeywordHandler {
  static override readonly keyword = "crew" as const;

  override activate(ast: KeywordAst, ctx: KeywordActivationContext): void {
    const card = ctx.game.cards.get(ctx.sourceCardId);
    if (!card) return;

    // 1. Flag set bookkeeping for hasKeyword("crew").
    if (!card.keywords) card.keywords = new Set();
    card.keywords.add("crew");

    // 2. Derive the power threshold (e.g. "1", "3"). Crew uses the "amount"
    //    param slot — see keyword-line.ts AMOUNT_KEYWORDS.
    const amountParam = ast.params?.amount;
    const crewPowerRaw = amountParam && amountParam.kind === "literal" ? (amountParam.raw as string) : "1";

    // 3. Build a synthetic AbilityAst pointing at CrewEffect. The cost is
    //    empty — the creature-tap sequence happens inside CrewEffect.resolve,
    //    not via the cost-payment infra.
    const fakeAst = {
      kind: "activated" as const,
      effect: {
        handlerKey: "Crew",
        params: {
          CrewPower: { kind: "literal" as const, raw: crewPowerRaw },
        },
      },
      cost: { raw: "" },
      rulesText: `Crew ${crewPowerRaw} — tap any number of untapped creatures you control with total power ${crewPowerRaw} or greater. This Vehicle becomes a creature until end of turn.`,
    };

    // 4. Synthesize the SpellAbility, active only on the battlefield.
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
      new Set(["crew"]),
    );

    card.spellAbilities.push(sa);
  }

  override deactivate(ast: KeywordAst, ctx: KeywordActivationContext): void {
    const card = ctx.game.cards.get(ctx.sourceCardId);
    if (!card) return;
    card.keywords?.delete("crew");
    void ast;
  }
}

keywordHandlerRegistry.register(CrewKeywordHandler);
