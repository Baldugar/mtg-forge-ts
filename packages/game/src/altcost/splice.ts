// SPDX-License-Identifier: GPL-3.0-or-later
// Splice — alternative add-on cost during the cast of an Arcane spell
// (Kamigawa, CR 702.46/702.47).
//
// CR 702.46a / 702.47a — "Splice onto Arcane [cost] — As you cast an
// Arcane spell, you may reveal this card from your hand and pay its
// splice cost. If you do, add this card's effects to that spell."
//
// DSL form in card definitions:
//   K:Splice:Arcane:cost      → splice cost is "cost", e.g. "1U" or "2"
//
// Wave 69 — the Arcane text-grafting flow lives in CastPipeline's
// `stepChooseSplices` step (post-`stepDetermineTotalCost`). That step
// detects Arcane spells, scans the caster's hand for K:Splice cards,
// yields a per-splicer confirmation, splices the chosen costs into the
// spell's total cost, emits CardsRevealed, and stamps the splicers on
// `card.splicedEffects` for the resolver to dispatch after the parent
// spell's effects resolve (CR 702.46a — "add this card's effects to
// that spell").
//
// This AltCost remains as a registry stub so cards using K:Splice via
// the older AltCost-based path don't break, but the canonical splice
// integration is the cast-pipeline step. `modifyCastContext` here is a
// no-op beyond stamping the marker; the real cost addition + reveal +
// graft happens in the cast pipeline.
import type { KeywordAst, ParamValue } from "@mtg-forge-ts/core";
import { ZoneType } from "@mtg-forge-ts/core";
import type { SpellAbility } from "../ability/spell-ability.js";
import type { Card } from "../card.js";
import type { CastContext } from "../cast/cast-context.js";
import type { Game } from "../game.js";
import type { AltCost } from "../registries/alt-cost-registry.js";
import { altCostRegistry } from "../registries/alt-cost-registry.js";

const extractSpliceKeyword = (card: Card): KeywordAst | null => {
  const def = card.paperCard.definition;
  if (!def) return null;
  const keywords = def.keywords as readonly KeywordAst[] | undefined;
  if (!keywords) return null;
  return keywords.find((k) => k.keyword === "splice") ?? null;
};

/** Splice's K-line is `K:Splice:Arcane:cost`. The current
 * keyword-line parser stores the entire tail-after-the-first-colon under
 * `params.detail` (the fallback param key) — so detail = "Arcane:cost".
 * We extract the cost as the portion after the inner colon. If the
 * inner colon is missing we treat the whole detail as the cost (this
 * handles non-Arcane Splice variants we may add in the future). */
const extractSpliceCost = (kw: KeywordAst): string | null => {
  const detailParam = kw.params?.detail as ParamValue | undefined;
  if (detailParam && detailParam.kind === "literal") {
    const raw = (detailParam.raw as string) || "";
    const colon = raw.indexOf(":");
    if (colon >= 0) return raw.slice(colon + 1).trim() || "0";
    return raw || "0";
  }
  // Fallback: a future parser change might split into params.cost.
  const costParam = kw.params?.cost as ParamValue | undefined;
  if (costParam && costParam.kind === "literal") {
    return (costParam.raw as string) || "0";
  }
  return null;
};

export const Splice: AltCost = {
  handlerKey: "Splice",

  isAvailable(card: Card, _game: Game): boolean {
    if (card.zone !== ZoneType.Hand) return false;
    const kw = extractSpliceKeyword(card);
    if (!kw) return false;
    return extractSpliceCost(kw) !== null;
  },

  modifyCastContext(ctx: CastContext, _sa: SpellAbility, _game: Game): void {
    // Wave 69 — the real splice graft happens in CastPipeline's
    // `stepChooseSplices` step. This AltCost stays as a marker only;
    // calling sites that drive splice via the AltCost path get the
    // marker on ctx.altCostUsed so any downstream provenance / SVar
    // selectors keyed on alt-cost names still see "Splice".
    (ctx as { altCostUsed: string | null }).altCostUsed = "Splice";
  },
};

altCostRegistry.register(Splice);
