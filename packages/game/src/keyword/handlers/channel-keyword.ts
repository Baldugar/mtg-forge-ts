// SPDX-License-Identifier: GPL-3.0-or-later
// ChannelKeywordHandler — processes K:Channel:<cost>:<effectSVar> keyword
// lines (Champions of Kamigawa / Saviors of Kamigawa, CR 702.74) and
// synthesizes a Hand-zone activated SpellAbility on the card.
//
// CR 702.74a — "Channel — [cost], Discard this card: [effect]." Each
// Channel card carries the regular spell side AND a separate hand-zone
// activated channel ability that discards the card to fire its named
// SVar effect.
//
// DSL form:
//   K:Channel:1 G:ChannelEff      → cost = "1 G", effect svar = "ChannelEff"
//   K:Channel:2:DigEff            → cost = "2",   effect svar = "DigEff"
//
// MVP scope:
//   1. Adds "channel" to card.keywords.
//   2. Synthesizes a Hand-zone activated SpellAbility with cost
//      `<cost>, Discard CARDNAME` and handlerKey "Channel". The named
//      SVar (which is itself an AbilityAst) is propagated via the
//      synthetic AST's params.EffectSVar so ChannelEffect can resolve it.
//
// The matching ChannelEffect resolver in
// packages/game/src/ability/effects/channel.ts looks up the SVar by name
// off sa.svars and yields its inner effect via the effectRegistry.
import type { KeywordAst, ParamValue, SVarAst } from "@mtg-forge-ts/core";
import { ZoneType } from "@mtg-forge-ts/core";
import { SpellAbility } from "../../ability/spell-ability.js";
import { keywordHandlerRegistry } from "../keyword-handler-registry.js";
import type { KeywordActivationContext } from "../keyword-handler.js";
import { KeywordHandler } from "../keyword-handler.js";

export class ChannelKeywordHandler extends KeywordHandler {
  static override readonly keyword = "channel" as const;

  override activate(ast: KeywordAst, ctx: KeywordActivationContext): void {
    const card = ctx.game.cards.get(ctx.sourceCardId);
    if (!card) return;

    if (!card.keywords) card.keywords = new Set();
    card.keywords.add("channel");

    const costParam = ast.params?.cost as ParamValue | undefined;
    const channelMana = costParam && costParam.kind === "literal" ? (costParam.raw as string) : "0";
    const effectParam = ast.params?.effect as ParamValue | undefined;
    const effectSVar = effectParam && effectParam.kind === "literal" ? (effectParam.raw as string) : "";

    const fakeAst = {
      kind: "activated" as const,
      effect: {
        handlerKey: "Channel",
        params: {
          EffectSVar: { kind: "literal" as const, raw: effectSVar },
        },
      },
      cost: { raw: `${channelMana}, Discard CARDNAME` },
      rulesText: `Channel — ${channelMana}, discard this card: ${effectSVar || "(no effect)"}`,
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
      new Set(["channel"]),
    );

    card.spellAbilities.push(sa);
  }

  override deactivate(_ast: KeywordAst, ctx: KeywordActivationContext): void {
    const card = ctx.game.cards.get(ctx.sourceCardId);
    card?.keywords?.delete("channel");
  }
}

keywordHandlerRegistry.register(ChannelKeywordHandler);
