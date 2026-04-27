// SPDX-License-Identifier: GPL-3.0-or-later
// MorphKeywordHandler — processes K:Morph:<cost> keyword lines (Onslaught,
// CR 702.36) and synthesizes a Battlefield-zone activated SpellAbility on
// the card so the controller can pay the morph cost to turn the card face-
// up (CR 702.36b — special action; functionally an activated ability for
// SP3 dispatch purposes).
//
// CR 702.36a — "Morph [cost]." A card with morph may be cast face down as
// a 2/2 colorless creature with no name, types, abilities, or mana cost
// for {3}. At any time, its controller may pay the morph cost to turn it
// face up.
//
// DSL form in card definitions:
//   K:Morph:1 U          → morph cost is {1}{U}
//   K:Morph:2 G G        → morph cost is {2}{G}{G}
//
// MVP scope:
//   1. Adds "morph" to card.keywords.
//   2. Stamps card.morphCost = "<cost>" so SVar selectors and the cast
//      pipeline's face-down alt-cast can read the cost.
//   3. Synthesizes a Battlefield-zone activated SpellAbility with cost
//      `<morphCost>` and handlerKey "TurnFaceUp"; the synthesized SA is
//      tagged "morph" so the resolver knows to flip without adding any
//      counter.
//
// The face-down alt-cast (cast as a 2/2 colorless creature for {3}) is the
// matching cast-pipeline-level concern — Wave 55 ships the keyword data-
// layer + flip-up activated ability. The 3-mana face-down cast variant is
// covered by Wave 55's altcost layer; the activated SA registered here is
// the durable contract.
import type { KeywordAst, ParamValue, SVarAst } from "@mtg-forge-ts/core";
import { ZoneType } from "@mtg-forge-ts/core";
import { SpellAbility } from "../../ability/spell-ability.js";
import { keywordHandlerRegistry } from "../keyword-handler-registry.js";
import type { KeywordActivationContext } from "../keyword-handler.js";
import { KeywordHandler } from "../keyword-handler.js";

export class MorphKeywordHandler extends KeywordHandler {
  static override readonly keyword = "morph" as const;

  override activate(ast: KeywordAst, ctx: KeywordActivationContext): void {
    const card = ctx.game.cards.get(ctx.sourceCardId);
    if (!card) return;

    if (!card.keywords) card.keywords = new Set();
    card.keywords.add("morph");

    const costParam = ast.params?.cost as ParamValue | undefined;
    const morphMana = costParam && costParam.kind === "literal" ? (costParam.raw as string) : "0";
    card.morphCost = morphMana;

    const fakeAst = {
      kind: "activated" as const,
      effect: { handlerKey: "TurnFaceUp", params: {} },
      cost: { raw: morphMana },
      rulesText: `Morph ${morphMana} — pay this card's morph cost to turn it face up.`,
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
      new Set(["morph", "turn_face_up"]),
    );

    card.spellAbilities.push(sa);
  }

  override deactivate(_ast: KeywordAst, ctx: KeywordActivationContext): void {
    const card = ctx.game.cards.get(ctx.sourceCardId);
    if (!card) return;
    card.keywords?.delete("morph");
    card.morphCost = undefined;
  }
}

keywordHandlerRegistry.register(MorphKeywordHandler);
