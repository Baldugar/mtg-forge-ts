// SPDX-License-Identifier: GPL-3.0-or-later
// CyclingKeywordHandler — processes K:Cycling:<cost> keyword lines and
// synthesizes a hand-zone activated SpellAbility on the card.
//
// When K:Cycling:R is parsed, the card definition carries:
//   { keyword: "cycling", params: { cost: { kind: "literal", raw: "R" } } }
//
// This handler:
//   1. Adds "cycling" to card.keywords (flag awareness for other systems).
//   2. Synthesizes an AbilityAst with:
//        - effect: { handlerKey: "Draw", params: { NumCards: {kind:"literal", raw:"1"} } }
//        - cost:   { raw: "<cycling-cost>, Discard CARDNAME" }
//   3. Wraps it in a SpellAbility with activeInZones = {Hand}.
//   4. Pushes it onto card.spellAbilities so activateAbility can pick it up.
//
// Deactivate removes the "cycling" keyword flag. The synthesized SpellAbility
// is not pruned from card.spellAbilities here (negligible cost; SP4 cleanup
// can do a proper per-kind prune if needed).
import type { KeywordAst } from "@mtg-forge-ts/core";
import { ZoneType } from "@mtg-forge-ts/core";
import { SpellAbility } from "../../ability/spell-ability.js";
import { keywordHandlerRegistry } from "../keyword-handler-registry.js";
import type { KeywordActivationContext } from "../keyword-handler.js";
import { KeywordHandler } from "../keyword-handler.js";

export class CyclingKeywordHandler extends KeywordHandler {
  static override readonly keyword = "cycling" as const;

  override activate(ast: KeywordAst, ctx: KeywordActivationContext): void {
    const card = ctx.game.cards.get(ctx.sourceCardId);
    if (!card) return;

    // 1. Add to flag Set so hasKeyword("cycling") works.
    if (!card.keywords) card.keywords = new Set();
    card.keywords.add("cycling");

    // 2. Derive the cycling mana cost (e.g. "R", "1", "2").
    const costParam = ast.params?.cost;
    const cyclingMana = costParam && costParam.kind === "literal" ? (costParam.raw as string) : "0";

    // 3. Build a synthetic AbilityAst for the cycling activated ability.
    //    Cost: "<cyclingMana>, Discard CARDNAME"
    //    Effect: Draw 1 card (handlerKey "Draw", NumCards = 1)
    const fakeAst = {
      kind: "activated" as const,
      effect: {
        handlerKey: "Draw",
        params: {
          NumCards: { kind: "literal" as const, raw: "1" },
        },
      },
      cost: { raw: `${cyclingMana}, Discard CARDNAME` },
      rulesText: `Cycling {${cyclingMana}} — discard this card, draw a card.`,
    };

    // 4. Synthesize a SpellAbility active in Hand only.
    const def = card.paperCard.definition;
    const svars =
      (def?.svars as ReadonlyMap<string, import("@mtg-forge-ts/core").SVarAst>) ??
      new Map<string, import("@mtg-forge-ts/core").SVarAst>();
    const sa = new SpellAbility(
      fakeAst,
      ctx.sourceCardId,
      ctx.controllerSeat,
      svars,
      [],
      undefined,
      new Set([ZoneType.Hand]),
    );

    card.spellAbilities.push(sa);
  }

  override deactivate(ast: KeywordAst, ctx: KeywordActivationContext): void {
    const card = ctx.game.cards.get(ctx.sourceCardId);
    if (!card) return;
    card.keywords?.delete("cycling");
    // Note: synthesized SpellAbility stays on spellAbilities; cleanup in SP4.
    void ast; // unused but satisfies the override signature
  }
}

keywordHandlerRegistry.register(CyclingKeywordHandler);
