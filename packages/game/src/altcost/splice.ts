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
// MVP scope:
//   - Register a SpliceAltCost handlerKey so the cast pipeline doesn't
//     reject K:Splice keywords as unknown alt-costs.
//   - isAvailable: card must be in Hand and carry K:Splice. The full
//     gate ("only available during the cast of an Arcane spell") would
//     require a sub-cast pipeline integration — it is deferred.
//   - modifyCastContext: TODO(advanced). The full splice path requires
//     grafting this card's effects/abilities onto the in-flight Arcane
//     spell, mutating its effect chain at cast time. That is a sizeable
//     infrastructure change (cast-pipeline must support add-on spells).
//     For now this stamps altCostUsed = "Splice" as a marker.
//
// The keyword registration + AltCost stamp closes the validator gap so
// Splice cards parse and resolve normally; the cards' Arcane interaction
// stays unimplemented behind the TODO(advanced) boundary.
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
    // TODO(advanced) — Splice's full integration grafts this card's
    // effects onto the in-flight Arcane spell. That requires a
    // cast-pipeline extension we haven't yet built. For now we only
    // stamp the marker so the cast loop's altCostUsed accounting is
    // consistent.
    (ctx as { altCostUsed: string | null }).altCostUsed = "Splice";
  },
};

altCostRegistry.register(Splice);
