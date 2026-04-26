// SPDX-License-Identifier: GPL-3.0-or-later
// SpecializeKeywordHandler — processes K:Specialize:<cost> keyword lines
// and synthesizes a battlefield-zone activated SpellAbility on the card.
//
// March of the Machine "Specialize" mechanic (CR 702.155):
//   - The card has a primary face plus five color-keyed faces
//     ("W"/"U"/"B"/"R"/"G") in PaperCard.faces.
//   - While the card is on the battlefield, its controller may pay the
//     specialize cost as a special action: choose a color, then turn the
//     card into the corresponding color-variant face.
//
// When K:Specialize:2 is parsed, the card definition carries:
//   { keyword: "specialize", params: { cost: { kind: "literal", raw: "2" } } }
//
// This handler:
//   1. Adds "specialize" to card.keywords (flag awareness).
//   2. Synthesizes an AbilityAst with handlerKey "Specialize" — the
//      registered SpecializeEffect (ability/effects/specialize.ts) drives
//      the chooseColor decision, sets card.face, bumps the layer engine
//      epoch, and emits CardSpecialized.
//   3. Wraps it in a SpellAbility with activeInZones = {Battlefield}.
//   4. Pushes it onto card.spellAbilities so activateAbility can pick it
//      up. Tag "specialize" is attached for symmetry with cycling's
//      provenance metadata (no event-emit hook today, but downstream
//      analytics / replay can introspect).
//
// Deactivate clears the keyword flag; the synthesized SpellAbility stays
// on spellAbilities (mirrors cycling's MVP cleanup deferral).
import type { KeywordAst, SVarAst } from "@mtg-forge-ts/core";
import { ZoneType } from "@mtg-forge-ts/core";
import { SpellAbility } from "../../ability/spell-ability.js";
import { keywordHandlerRegistry } from "../keyword-handler-registry.js";
import type { KeywordActivationContext } from "../keyword-handler.js";
import { KeywordHandler } from "../keyword-handler.js";

export class SpecializeKeywordHandler extends KeywordHandler {
  static override readonly keyword = "specialize" as const;

  override activate(ast: KeywordAst, ctx: KeywordActivationContext): void {
    const card = ctx.game.cards.get(ctx.sourceCardId);
    if (!card) return;

    // 1. Flag set bookkeeping for hasKeyword("specialize").
    if (!card.keywords) card.keywords = new Set();
    card.keywords.add("specialize");

    // 2. Derive the specialize mana cost (e.g. "2", "5", "1").
    const costParam = ast.params?.cost;
    const specializeCost = costParam && costParam.kind === "literal" ? (costParam.raw as string) : "0";

    // 3. Build a synthetic AbilityAst pointing at SpecializeEffect.
    const fakeAst = {
      kind: "activated" as const,
      effect: {
        handlerKey: "Specialize",
        params: {},
      },
      cost: { raw: specializeCost },
      rulesText: `Specialize {${specializeCost}} — choose a color; CARDNAME becomes that color's variant.`,
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
      new Set(["specialize"]),
    );

    card.spellAbilities.push(sa);
  }

  override deactivate(ast: KeywordAst, ctx: KeywordActivationContext): void {
    const card = ctx.game.cards.get(ctx.sourceCardId);
    if (!card) return;
    card.keywords?.delete("specialize");
    void ast;
  }
}

keywordHandlerRegistry.register(SpecializeKeywordHandler);
