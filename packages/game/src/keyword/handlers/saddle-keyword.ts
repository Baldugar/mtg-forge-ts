// SPDX-License-Identifier: GPL-3.0-or-later
// SaddleKeywordHandler — processes K:Saddle:N keyword lines and synthesizes
// a battlefield-zone activated SpellAbility on the Mount.
//
// CR 702.165 — Saddle N: "Tap any number of untapped creatures you control
// other than this one with total power N or greater: This Mount becomes
// saddled until end of turn." Mounts are already creatures by default; the
// saddled flag is consulted by other triggers (BecomesSaddled / Saddled) and
// SVar conditions referencing "Saddled" state. The keyword line takes the
// form `K:Saddle:N` where N is the power threshold; the parser stores it on
// KeywordAst.params.amount (see keyword-line.ts — "saddle" is in
// AMOUNT_KEYWORDS).
//
// Mirrors CrewKeywordHandler exactly. Differences live in SaddleEffect:
//   - flag stamped is `card.saddledUntilEot` (not crewedUntilEot),
//   - DOES NOT add the Creature type (Mounts already have it),
//   - emits the Saddled event (not Crewed).
//
// Deactivate clears the keyword flag; the synthesized SpellAbility stays on
// spellAbilities (mirrors cycling/specialize MVP cleanup deferral).
import type { KeywordAst, SVarAst } from "@mtg-forge-ts/core";
import { ZoneType } from "@mtg-forge-ts/core";
import { SpellAbility } from "../../ability/spell-ability.js";
import { keywordHandlerRegistry } from "../keyword-handler-registry.js";
import type { KeywordActivationContext } from "../keyword-handler.js";
import { KeywordHandler } from "../keyword-handler.js";

export class SaddleKeywordHandler extends KeywordHandler {
  static override readonly keyword = "saddle" as const;

  override activate(ast: KeywordAst, ctx: KeywordActivationContext): void {
    const card = ctx.game.cards.get(ctx.sourceCardId);
    if (!card) return;

    // 1. Flag set bookkeeping for hasKeyword("saddle").
    if (!card.keywords) card.keywords = new Set();
    card.keywords.add("saddle");

    // 2. Derive the power threshold (e.g. "2", "3"). Saddle uses the "amount"
    //    param slot — see keyword-line.ts AMOUNT_KEYWORDS.
    const amountParam = ast.params?.amount;
    const saddlePowerRaw = amountParam && amountParam.kind === "literal" ? (amountParam.raw as string) : "1";

    // 3. Build a synthetic AbilityAst pointing at SaddleEffect. Empty cost —
    //    the creature-tap sequence happens inside SaddleEffect.resolve.
    const fakeAst = {
      kind: "activated" as const,
      effect: {
        handlerKey: "Saddle",
        params: {
          SaddlePower: { kind: "literal" as const, raw: saddlePowerRaw },
        },
      },
      cost: { raw: "" },
      rulesText: `Saddle ${saddlePowerRaw} — tap any number of untapped creatures you control with total power ${saddlePowerRaw} or greater. This Mount becomes saddled until end of turn.`,
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
      new Set(["saddle"]),
    );

    card.spellAbilities.push(sa);
  }

  override deactivate(ast: KeywordAst, ctx: KeywordActivationContext): void {
    const card = ctx.game.cards.get(ctx.sourceCardId);
    if (!card) return;
    card.keywords?.delete("saddle");
    void ast;
  }
}

keywordHandlerRegistry.register(SaddleKeywordHandler);
