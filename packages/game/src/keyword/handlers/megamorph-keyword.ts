// SPDX-License-Identifier: GPL-3.0-or-later
// MegamorphKeywordHandler — processes K:Megamorph:<cost> keyword lines
// (Khans of Tarkir, CR 702.94) and synthesizes a Battlefield-zone
// activated SpellAbility on the card so the controller can pay the
// megamorph cost to turn the card face-up. Functionally identical to
// Morph, except that on flip-up the creature gains a +1/+1 counter
// (CR 702.94a).
//
// DSL form in card definitions:
//   K:Megamorph:R W         → megamorph cost is {R}{W}
//   K:Megamorph:3 G         → megamorph cost is {3}{G}
//
// MVP scope:
//   1. Adds "megamorph" to card.keywords.
//   2. Stamps card.morphCost = "<cost>" (shared slot — Megamorph reuses
//      morph's slot since the only difference is the counter on flip-up,
//      which the SA tag flags via "megamorph").
//   3. Synthesizes a Battlefield-zone activated SpellAbility with cost
//      `<megamorphCost>` and handlerKey "TurnFaceUp"; tagged "megamorph"
//      so the TurnFaceUp resolver adds a +1/+1 counter post-flip.
import type { KeywordAst, ParamValue, SVarAst } from "@mtg-forge-ts/core";
import { ZoneType } from "@mtg-forge-ts/core";
import { SpellAbility } from "../../ability/spell-ability.js";
import { keywordHandlerRegistry } from "../keyword-handler-registry.js";
import type { KeywordActivationContext } from "../keyword-handler.js";
import { KeywordHandler } from "../keyword-handler.js";

export class MegamorphKeywordHandler extends KeywordHandler {
  static override readonly keyword = "megamorph" as const;

  override activate(ast: KeywordAst, ctx: KeywordActivationContext): void {
    const card = ctx.game.cards.get(ctx.sourceCardId);
    if (!card) return;

    if (!card.keywords) card.keywords = new Set();
    card.keywords.add("megamorph");

    const costParam = ast.params?.cost as ParamValue | undefined;
    const megaMana = costParam && costParam.kind === "literal" ? (costParam.raw as string) : "0";
    card.morphCost = megaMana;

    const fakeAst = {
      kind: "activated" as const,
      effect: { handlerKey: "TurnFaceUp", params: {} },
      cost: { raw: megaMana },
      rulesText: `Megamorph ${megaMana} — pay this card's megamorph cost to turn it face up; it gains a +1/+1 counter.`,
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
      new Set(["megamorph", "turn_face_up"]),
    );

    card.spellAbilities.push(sa);
  }

  override deactivate(_ast: KeywordAst, ctx: KeywordActivationContext): void {
    const card = ctx.game.cards.get(ctx.sourceCardId);
    if (!card) return;
    card.keywords?.delete("megamorph");
    card.morphCost = undefined;
  }
}

keywordHandlerRegistry.register(MegamorphKeywordHandler);
