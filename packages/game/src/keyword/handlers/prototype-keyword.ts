// SPDX-License-Identifier: GPL-3.0-or-later
// PrototypeKeywordHandler — processes K:Prototype:<cost>:<P/T> keyword
// lines (Brothers' War, CR 702.160) and stamps the alternate cost +
// alt-P/T on the source card so the cast pipeline can offer the
// "smaller" version.
//
// CR 702.160a — "Prototype [cost] — [stats]" — "You may cast this spell
// with different mana cost, color, and size. It keeps its abilities and
// types."
//
// Wave 93 — closes the Layer 7b registration TODO. The handler now:
//   1. Adds "prototype" to card.keywords + stamps card.prototypeCost +
//      card.prototypePT.
//   2. Registers a permanent Layer 7b "set" effect targeting Card.Self,
//      gated on `card.prototypeCast === true`. The targetCardIdFn
//      returns the source id only when the prototypeCast flag is live,
//      so the override is silently inert until the cast pipeline stamps
//      the flag at additional-cost time. P/T is parsed once at
//      activate; deactivate strips the kw + slots (the
//      ContinuousEffectRegistry permanent-duration entry stays — it
//      remains gated on the now-undefined flag, which makes
//      targetCardIdFn return null, so the effect filters out cleanly).
//
// DSL form:
//   K:Prototype:2 R:2/3   → cast for {2}{R} as a 2/3
//   K:Prototype:1 U U:2/2 → cast for {1}{U}{U} as a 2/2
//
// Wave 59 — keyword-line parser cleanup moved prototype into
// TWO_PARAM_KEYWORDS (`cost`:`pt`); the canonical AST is now
// `params: { cost: <mana>, pt: <P/T> }`. The legacy single-slot form
// (where the raw text combines "cost P/T" or "cost:P/T") is retained for
// snapshot-restore tolerance.
import { type ContinuousEffect, type KeywordAst, Layer, type ParamValue } from "@mtg-forge-ts/core";
import type { Layer7bEffect } from "../../layers/layer7-pt.js";
import { keywordHandlerRegistry } from "../keyword-handler-registry.js";
import type { KeywordActivationContext } from "../keyword-handler.js";
import { KeywordHandler } from "../keyword-handler.js";

const splitCostAndPT = (raw: string): { cost: string; pt: string | null } => {
  // The cost may itself contain spaces ("2 R") so we split on the LAST
  // colon-or-slash boundary that introduces the P/T pair (which is
  // exactly two integers separated by "/"). Find the first occurrence
  // of /\d+\/\d+/ from the right and split there.
  const ptMatch = raw.match(/\s*(\d+\/\d+)\s*$/);
  if (!ptMatch) return { cost: raw.trim(), pt: null };
  const pt = ptMatch[1] ?? null;
  const cost = raw.slice(0, raw.length - (ptMatch[0]?.length ?? 0)).trim();
  // Trim a trailing colon if the parser preserved it.
  const cleanCost = cost.endsWith(":") ? cost.slice(0, -1).trim() : cost;
  return { cost: cleanCost, pt };
};

const parsePT = (pt: string): { power: number; toughness: number } | null => {
  const m = /^(\d+)\/(\d+)$/.exec(pt.trim());
  if (!m) return null;
  const power = Number.parseInt(m[1] as string, 10);
  const toughness = Number.parseInt(m[2] as string, 10);
  if (!Number.isFinite(power) || !Number.isFinite(toughness)) return null;
  return { power, toughness };
};

export class PrototypeKeywordHandler extends KeywordHandler {
  static override readonly keyword = "prototype" as const;

  override activate(ast: KeywordAst, ctx: KeywordActivationContext): void {
    const card = ctx.game.cards.get(ctx.sourceCardId);
    if (!card) return;

    if (!card.keywords) card.keywords = new Set();
    card.keywords.add("prototype");

    const costParam = ast.params?.cost as ParamValue | undefined;
    const ptParam = ast.params?.pt as ParamValue | undefined;
    const rawCost = costParam && costParam.kind === "literal" ? (costParam.raw as string) : "";
    const rawPt = ptParam && ptParam.kind === "literal" ? (ptParam.raw as string) : "";

    let resolvedPt: string | undefined;
    if (rawPt.length > 0) {
      // Canonical TWO_PARAM_KEYWORDS form — slots already split.
      card.prototypeCost = rawCost.length > 0 ? rawCost : "0";
      card.prototypePT = rawPt;
      resolvedPt = rawPt;
    } else {
      // Legacy single-slot form ("2 R 2/3" or "2 R:2/3") — split here.
      const { cost, pt } = splitCostAndPT(rawCost);
      card.prototypeCost = cost.length > 0 ? cost : "0";
      if (pt !== null) {
        card.prototypePT = pt;
        resolvedPt = pt;
      }
    }

    // Layer 7b registration — gated SetPower/SetToughness scoped to
    // Card.Self when prototypeCast is live. The targetCardIdFn returns
    // null when the flag isn't set so the effect is filtered out by
    // applyLayer7b's per-card scoping (Wave 47). Permanent duration so
    // the override persists for the prototype card's lifetime on the
    // battlefield (CR 702.160a — the alt-P/T applies as long as the
    // spell was cast as prototype).
    if (resolvedPt === undefined) return;
    const parsed = parsePT(resolvedPt);
    if (parsed === null) return;
    const game = ctx.game;
    const sourceCardId = ctx.sourceCardId;
    const ts = game.newEntityId();
    const ptSet: Layer7bEffect = {
      kind: "set",
      power: parsed.power,
      toughness: parsed.toughness,
      timestamp: ts,
      sourceAbilityId: sourceCardId,
      targetCardIdFn: () => {
        const c = game.cards.get(sourceCardId);
        if (!c) return null;
        if (c.prototypeCast !== true) return null;
        return sourceCardId;
      },
    };
    const ce: ContinuousEffect = {
      id: game.newEntityId(),
      sourceCardId,
      timestamp: ts,
      layer: Layer.L7b_PTSet,
      duration: { kind: "permanent" },
      payload: { kind: "pt-set", effect: ptSet },
    };
    game.continuousEffectRegistry.register(ce);
  }

  override deactivate(_ast: KeywordAst, ctx: KeywordActivationContext): void {
    const card = ctx.game.cards.get(ctx.sourceCardId);
    if (!card) return;
    card.keywords?.delete("prototype");
    card.prototypeCost = undefined;
    card.prototypePT = undefined;
  }
}

keywordHandlerRegistry.register(PrototypeKeywordHandler);
