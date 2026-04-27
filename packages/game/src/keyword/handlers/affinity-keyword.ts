// SPDX-License-Identifier: GPL-3.0-or-later
// AffinityKeywordHandler — processes K:Affinity:<filter> keyword lines
// (Mirrodin, CR 702.40) and registers a per-card cost-modification static
// effect that reduces the spell's generic cost by the count of permanents
// matching the filter the controller controls.
//
// CR 702.40a — "Affinity for [text]" — "This spell costs {1} less to cast
// for each [text] you control."
//
// DSL forms in card definitions (Forge):
//   K:Affinity:Card.Artifact     → {1} less per artifact you control
//   K:Affinity:Land              → {1} less per land you control (Wave 59
//                                   tolerates the bare base — no "Card." prefix)
//   K:Affinity:Card.Creature.Wizard → {1} less per Wizard creature you ctrl
//
// MVP scope:
//   1. Adds "affinity" to card.keywords.
//   2. Stamps `card.affinityFilter` (the raw filter string).
//   3. Registers a costModification StaticAbility on game.staticEffectRegistry.
//      The filter narrows to the source spell (Card.Self) and is dynamic on
//      the generic delta — counting matching permanents the controller
//      controls at solve time. The cost-mod runtime (apply-cost-mods.ts)
//      already supports closures returning negative deltas, so no further
//      cast-pipeline plumbing is needed; the reduction flows through the
//      same channel as Wave 6 ReduceCost.
//
// Filter parsing (MVP):
//   - The filter string is split on "." into a base + qualifiers (same
//     grammar as cost-mod-filter.ts, minus the colored / non-prefixed
//     forms — Affinity prints have always been simple type-name filters).
//   - The matching helper walks each permanent the controller controls
//     and tests cardHasType for each segment. The base "Card" is treated
//     as a wildcard match against any card.
import type { CardType } from "@mtg-forge-ts/core";
import { type EntityId, type KeywordAst, type ParamValue, ZoneType } from "@mtg-forge-ts/core";
import type { Card } from "../../card.js";
import type { Game } from "../../game.js";
import type { CostModEffect } from "../../statics/cost-mod-contributor.js";
import { keywordHandlerRegistry } from "../keyword-handler-registry.js";
import type { KeywordActivationContext } from "../keyword-handler.js";
import { KeywordHandler } from "../keyword-handler.js";

const cardHasTypeName = (card: Card, typeName: string): boolean => {
  const def = card.paperCard.definition;
  if (!def) return false;
  const types = def.types as {
    has?: (t: string | CardType) => boolean;
    hasSubtype?: (s: string) => boolean;
  };
  if (typeof types.has === "function" && types.has(typeName)) return true;
  if (typeof types.hasSubtype === "function" && types.hasSubtype(typeName)) return true;
  return false;
};

const permanentMatchesFilter = (card: Card, rawFilter: string): boolean => {
  const segments = rawFilter
    .split(".")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  if (segments.length === 0) return false;
  // First segment is the base type. "Card" is a wildcard.
  const base = segments[0] ?? "Card";
  if (base !== "Card" && !cardHasTypeName(card, base)) return false;
  // Each subsequent segment is an AND-qualifier; we treat all as type/subtype
  // checks (Affinity prints have never used the colored / controller forms).
  for (let i = 1; i < segments.length; i++) {
    const q = segments[i] ?? "";
    if (q.length === 0) continue;
    if (!cardHasTypeName(card, q)) return false;
  }
  return true;
};

const countAffinityPermanents = (
  game: Game,
  controllerSeat: number,
  rawFilter: string,
  selfCardId: EntityId,
): number => {
  let count = 0;
  for (const [id, card] of game.cards) {
    if (id === selfCardId) continue;
    if (card.zone !== ZoneType.Battlefield) continue;
    if ((card.controllerSeat as number) !== controllerSeat) continue;
    if (!permanentMatchesFilter(card, rawFilter)) continue;
    count++;
  }
  return count;
};

export class AffinityKeywordHandler extends KeywordHandler {
  static override readonly keyword = "affinity" as const;

  override activate(ast: KeywordAst, ctx: KeywordActivationContext): void {
    const card = ctx.game.cards.get(ctx.sourceCardId);
    if (!card) return;

    if (!card.keywords) card.keywords = new Set();
    card.keywords.add("affinity");

    // The parser stores Affinity's filter under "type" (TYPE_KEYWORDS) when
    // wired explicitly, but Affinity isn't in any slot set today. The
    // Wave 59 stamp tolerates both `type` and `detail` (current parser).
    const filterParam =
      (ast.params?.type as ParamValue | undefined) ?? (ast.params?.detail as ParamValue | undefined);
    const rawFilter = filterParam && filterParam.kind === "literal" ? (filterParam.raw as string).trim() : "";
    if (rawFilter.length === 0) return;
    card.affinityFilter = rawFilter;

    // Register the per-card cost-mod static. The describe() returns a
    // CostModEffect whose filter narrows to the source spell (kind=spell
    // AND sourceCardId === self), and whose generic-delta closure counts
    // matching permanents at apply time.
    const game = ctx.game;
    const sourceCardId = ctx.sourceCardId;
    const controllerSeat = ctx.controllerSeat;
    const staticId = game.newEntityId();

    const filterClosure = (item: unknown, _g: Game): boolean => {
      if (item === null || typeof item !== "object") return false;
      const probe = item as { sourceCardId?: unknown; kind?: unknown };
      if (probe.kind !== "spell") return false;
      return probe.sourceCardId === sourceCardId;
    };

    const dynamicDelta = (item: unknown, g: Game): number => {
      // The item's controller pays the cost; for affinity the count is
      // taken over permanents the spell's controller controls.
      const probe = item as { controllerSeat?: unknown };
      const seat =
        typeof probe.controllerSeat === "number" ? probe.controllerSeat : (controllerSeat as number);
      const n = countAffinityPermanents(g, seat as number, rawFilter, sourceCardId);
      return -Math.max(0, n);
    };

    const effect: CostModEffect = {
      sourceStaticId: staticId,
      filter: filterClosure,
      delta: { generic: dynamicDelta },
    };

    game.staticEffectRegistry.register({
      id: staticId,
      kind: "static",
      sourceCardId,
      activeInZones: new Set([ZoneType.Hand, ZoneType.Stack]),
      timestamp: game.newEntityId(),
      controllerSeatAtReg: controllerSeat,
      category: "costModification",
      mode: "ReduceCost",
      describe: () => effect,
    });
  }

  override deactivate(_ast: KeywordAst, ctx: KeywordActivationContext): void {
    const card = ctx.game.cards.get(ctx.sourceCardId);
    if (!card) return;
    card.keywords?.delete("affinity");
    card.affinityFilter = undefined;
  }
}

keywordHandlerRegistry.register(AffinityKeywordHandler);
