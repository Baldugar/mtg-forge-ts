// SPDX-License-Identifier: GPL-3.0-or-later
// DisguiseKeywordHandler — processes K:Disguise:<cost> keyword lines
// (Murders at Karlov Manor, CR 702.166) and synthesizes a Battlefield-
// zone activated SpellAbility so the controller can pay the disguise
// cost to turn the face-down card face up. Functionally Morph + Ward 2:
// the face-down side has Ward 2 (CR 702.166b) so opposing targeting
// triggers Wave 49's Ward replacement.
//
// DSL form in card definitions:
//   K:Disguise:1 W         → disguise cost is {1}{W}
//   K:Disguise:3           → disguise cost is {3}
//
// MVP scope:
//   1. Adds "disguise" to card.keywords.
//   2. Stamps card.disguiseCost = "<cost>" AND card.morphCost = "<cost>"
//      (the synthesized activated SA reads via the same TurnFaceUp
//      handlerKey path; disguiseCost is the durable per-keyword slot).
//   3. Stamps card.wardCost = "2" so Wave 49's Ward replacement fires
//      while the card is face-down with disguise-kind FaceDownState.
//   4. Synthesizes a Battlefield-zone activated SpellAbility with cost
//      `<disguiseCost>` and handlerKey "TurnFaceUp"; tagged "disguise"
//      so the TurnFaceUp resolver clears the ward stamp on flip-up.
import type { KeywordAst, ParamValue, SVarAst } from "@mtg-forge-ts/core";
import { ZoneType } from "@mtg-forge-ts/core";
import { SpellAbility } from "../../ability/spell-ability.js";
import { keywordHandlerRegistry } from "../keyword-handler-registry.js";
import type { KeywordActivationContext } from "../keyword-handler.js";
import { KeywordHandler } from "../keyword-handler.js";

export class DisguiseKeywordHandler extends KeywordHandler {
  static override readonly keyword = "disguise" as const;

  override activate(ast: KeywordAst, ctx: KeywordActivationContext): void {
    const card = ctx.game.cards.get(ctx.sourceCardId);
    if (!card) return;

    if (!card.keywords) card.keywords = new Set();
    card.keywords.add("disguise");

    const costParam = ast.params?.cost as ParamValue | undefined;
    const disguiseMana = costParam && costParam.kind === "literal" ? (costParam.raw as string) : "0";
    card.disguiseCost = disguiseMana;
    card.morphCost = disguiseMana;
    // CR 702.166b — face-down side has Ward 2; stamp wardCost so Wave
    // 49's ward trigger fires when an opponent targets the face-down
    // creature. The slot is cleared by the TurnFaceUp resolver on flip.
    card.wardCost = "2";

    const fakeAst = {
      kind: "activated" as const,
      effect: { handlerKey: "TurnFaceUp", params: {} },
      cost: { raw: disguiseMana },
      rulesText: `Disguise ${disguiseMana} — pay this card's disguise cost to turn it face up. While face down, this card has ward 2.`,
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
      new Set(["disguise", "turn_face_up"]),
    );

    card.spellAbilities.push(sa);
  }

  override deactivate(_ast: KeywordAst, ctx: KeywordActivationContext): void {
    const card = ctx.game.cards.get(ctx.sourceCardId);
    if (!card) return;
    card.keywords?.delete("disguise");
    card.disguiseCost = undefined;
    card.morphCost = undefined;
    card.wardCost = undefined;
  }
}

keywordHandlerRegistry.register(DisguiseKeywordHandler);
