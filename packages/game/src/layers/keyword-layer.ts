// SPDX-License-Identifier: GPL-3.0-or-later
// Wave 32 — Layer 6 keyword grants. Forge's `S:Mode$ Continuous |
// AddKeyword$ X` and the broader keyword-granting Layer 6 effects share
// this storage. Effects are addressed by source ability id and applied
// at compute time; the LayerEngine consults this list when answering
// `effectiveKeywords(cardId)` (and via combat/SBA helpers' `hasKeyword`).
//
// Storage shape mirrors Layer 7c (modify): a list of effects each
// carrying a `targetCardIdFn` so per-attachment / per-condition grants
// can compute their target dynamically. When the function returns null
// (condition false, target absent), the grant does not apply for that
// card.
//
// `keyword` is space-preserved (e.g. "First Strike", "Vigilance") —
// callers normalize to the lowercase_snake_case ids the keyword registry
// uses (see `normalizeKeywordToken` in this module).
import type { EntityId } from "@mtg-forge-ts/core";

export interface Layer6KeywordGrant {
  /** The granted keyword in its Forge form (e.g. "First Strike"). */
  readonly keyword: string;
  /** The static / continuous-effect ability id that produced the grant. */
  readonly sourceAbilityId: EntityId | null;
  /** Timestamp for ordering; matches sibling layer effects. */
  readonly timestamp: number;
  /**
   * Compute the target card id at apply time. Returns `null` to
   * suppress the grant (e.g. Threshold condition false, attached-to
   * target absent). The LayerEngine evaluates this on every
   * computeCharacteristics call for the affected card, so dynamic
   * conditions re-check on every epoch bump.
   */
  readonly targetCardIdFn: () => EntityId | null;
  /**
   * Wave 47 — multi-target alternative for `Affected$ Creature.YouCtrl`
   * and similar broadcasts. When set, the grant applies to a card iff the
   * predicate returns true. Takes precedence over `targetCardIdFn` if
   * both are present (broadcast supersedes single-target).
   */
  readonly appliesToCardIdFn?: (cardId: EntityId) => boolean;
}

/**
 * Normalise a Forge keyword string ("First Strike", "Vigilance") to the
 * lowercase_snake_case id the keyword registry / hasKeyword helper uses
 * ("first_strike", "vigilance"). Whitespace runs collapse to a single
 * underscore; non-alphanumeric chars are stripped.
 */
export const normalizeKeywordToken = (raw: string): string =>
  raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

/**
 * Compute the effective set of granted keyword ids for a card, given a
 * list of grants. Caller passes a Map<EntityId, Set<string>> output
 * shape if it wants per-card caching; this helper returns the per-card
 * Set on demand.
 */
export const grantsForCard = (cardId: EntityId, grants: readonly Layer6KeywordGrant[]): Set<string> => {
  const out = new Set<string>();
  for (const g of grants) {
    // Wave 47 — multi-target predicate (broadcast) takes precedence.
    if (g.appliesToCardIdFn !== undefined) {
      if (!g.appliesToCardIdFn(cardId)) continue;
    } else if (g.targetCardIdFn() !== cardId) continue;
    out.add(normalizeKeywordToken(g.keyword));
  }
  return out;
};
