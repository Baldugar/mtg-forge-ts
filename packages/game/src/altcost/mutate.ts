// SPDX-License-Identifier: GPL-3.0-or-later
// Mutate — alternative casting cost from hand. The spell becomes a "merge"
// spell that targets a non-Human creature you own; on resolution, the new
// card is placed over (top) or under (bottom) the target, forming a single
// game object whose name/types/P/T come from the topmost card and whose
// abilities are the union of every card in the merged pile (CR 702.139).
//
// CR 702.139a: "Mutate [cost] — If you cast this spell for its mutate cost,
// put it over or under target non-Human creature you own. They become the
// same object. That object has the abilities of each of those cards. It
// has the name, types, power, toughness, mana cost, and color of the top
// card."
//
// DSL form in card definitions:
//   K:Mutate:1 G U   → mutate cost is {1}{G}{U}
//
// isAvailable:
//   - Card must be in the Hand zone.
//   - Card must carry a "mutate" keyword with a cost parameter.
//   - At least one non-Human creature owned by the casting player must be
//     on the battlefield to serve as the merge target.
//
// modifyCastContext:
//   - Replaces ctx.totalCost.base with the mutate mana cost string.
//   - Sets ctx.altCostUsed = "Mutate".
//   - Sets ctx.mutated = true. The cast pipeline reads this to:
//       1. Synthesize a "Creature.YouOwn.nonHuman" target restriction in
//          stepChooseTargets so the caster picks one merge target.
//       2. Tag the bound SpellAbility with `tags: Set(["mutated"])` so
//          resolveStackItem branches into the merge logic instead of the
//          standard permanent-ETB resolver.
//   - Sets ctx.alternativeZoneDestination = Battlefield. The mutate spell
//     resolves onto the battlefield (as part of the merged pile); we mark
//     the destination explicitly so the resolver path doesn't accidentally
//     route the card to a graveyard for being a non-permanent spell.
import { CardType, type KeywordAst, type ParamValue, ZoneType } from "@mtg-forge-ts/core";
import type { SpellAbility } from "../ability/spell-ability.js";
import type { Card } from "../card.js";
import type { CastContext } from "../cast/cast-context.js";
import type { Game } from "../game.js";
import type { AltCost } from "../registries/alt-cost-registry.js";
import { altCostRegistry } from "../registries/alt-cost-registry.js";

const extractMutateCost = (card: Card): string | null => {
  const def = card.paperCard.definition;
  if (!def) return null;
  const keywords = def.keywords as readonly KeywordAst[] | undefined;
  if (!keywords) return null;
  const kw = keywords.find((k) => k.keyword === "mutate");
  if (!kw) return null;
  const costParam = kw.params?.cost as ParamValue | undefined;
  if (!costParam || costParam.kind !== "literal") return null;
  return (costParam.raw as string) || "0";
};

/**
 * Returns true if at least one non-Human creature owned by `castingSeat` sits
 * on the battlefield. Uses the layer engine's computed characteristics so
 * type/subtype-changing effects compose normally (e.g. an animated land that
 * becomes a creature qualifies if it's not subtyped Human).
 */
const hasEligibleMutateTarget = (game: Game, castingSeat: Card["ownerSeat"]): boolean => {
  for (const [id, card] of game.cards) {
    if (card.zone !== ZoneType.Battlefield) continue;
    if (card.ownerSeat !== castingSeat) continue;
    // A mutated-into card is hidden inside another's pile; skip it.
    if (card.mutatedInto !== undefined) continue;
    const chars = game.layerEngine.computeCharacteristics(id);
    if (!chars.types.has(CardType.Creature)) continue;
    if (chars.subtypes.has("Human")) continue;
    return true;
  }
  return false;
};

export const Mutate: AltCost = {
  handlerKey: "Mutate",

  isAvailable(card: Card, game: Game): boolean {
    if (card.zone !== ZoneType.Hand) return false;
    if (extractMutateCost(card) === null) return false;
    return hasEligibleMutateTarget(game, card.ownerSeat);
  },

  modifyCastContext(ctx: CastContext, _sa: SpellAbility, game: Game): void {
    const card = game.cards.get(ctx.sourceCardId);
    if (!card) return;
    const cost = extractMutateCost(card);
    if (cost === null) return;

    (ctx as { altCostUsed: string | null }).altCostUsed = "Mutate";
    (ctx as { totalCost: unknown }).totalCost = {
      base: { raw: cost },
    };

    // Mutate spells resolve onto the battlefield (merged into the target's
    // pile) — pin the destination so the non-permanent-spell graveyard
    // fallback in resolveStackItem doesn't kick in for non-creature mutate
    // cards. (Most mutate cards are creatures, but the explicit pin keeps
    // the resolution path uniform.)
    (ctx as { alternativeZoneDestination: ZoneType | undefined }).alternativeZoneDestination =
      ZoneType.Battlefield;

    // Mark the cast as mutated so stepChooseTargets enumerates non-Human
    // creatures the caster owns and finalizeStackItem stamps the bound
    // SpellAbility's tags so the resolver knows to merge.
    (ctx as { mutated: boolean }).mutated = true;
  },
};

altCostRegistry.register(Mutate);
