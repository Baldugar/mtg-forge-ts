// SPDX-License-Identifier: GPL-3.0-or-later
// Wave 70.D — query helpers for the three Wave-70.D static modes:
//   - CantTarget                → canBeTargetedBy
//   - CantAttackUnless          → canAttackUnlessPaid (MVP returns
//                                 false on match — cost is "unpaid")
//   - CombatDamageToughness     → usesToughnessForCombatDamage
//
// Each helper walks the staticEffectRegistry by mode/category and
// returns a single value the consumer site uses to short-circuit a
// game decision (target legality, attack legality, combat-damage
// assignment).
//
// Read-side consumers:
//   - canBeTargetedBy            → target/enumeration.ts (filters out
//                                  ineligible targets at enumerate time)
//   - canAttackUnlessPaid        → already routed via the cantAttack
//                                  Restriction emitted by the handler;
//                                  the helper is exposed for direct
//                                  consultation (e.g. AI evaluation)
//   - usesToughnessForCombatDamage → combat/damage-assignment-helpers.ts
//                                  (attackerPower swaps in toughness on match)
//
// Why standalone helpers (not methods on Game / Game.flags): the static
// registry already snapshots and restores cleanly, so walking the registry
// per-query is the right source of truth — and matches the Wave 60.A and
// 60.H patterns.
import type { EntityId, PlayerSeat } from "@mtg-forge-ts/core";
import type { Game } from "../game.js";
import type { CantAttackUnlessPayload } from "../static/handlers/cant-attack-unless-static.js";
import type { CantTargetPayload } from "../static/handlers/cant-target-static.js";
import type { CombatDamageToughnessPayload } from "../static/handlers/combat-damage-toughness-static.js";
import type { Restriction } from "./cant-must-may.js";

/**
 * Optional context describing the casting/activating SA. The targeting
 * pre-filter passes whatever it knows — when the source / activator
 * fields are absent, the gate matches generously (treats the unknown
 * as "any source / any activator"), which matches Forge's behaviour
 * during early target enumeration before the SA is fully bound.
 */
export interface TargetingContext {
  /** SA host card id ("source"). undefined when not yet bound. */
  readonly sourceId?: EntityId;
  /** Activator (player declaring the cast / activating the ability). */
  readonly activatorSeat?: PlayerSeat;
  /** SA classification. undefined → match any. */
  readonly saKind?: "Spell" | "Activated" | "Triggered" | "Other";
}

/**
 * True iff `cardId` may be the target of a spell/ability under the
 * given casting context. False iff any active CantTarget static
 * matches the card AND the (sourceId, activatorSeat, saKind) tuple.
 */
export const canBeTargetedBy = (game: Game, cardId: EntityId, ctx: TargetingContext): boolean => {
  const statics = game.staticEffectRegistry.byMode("CantTarget");
  for (const s of statics) {
    const r = s.describe() as Restriction;
    const payload = r.payload as CantTargetPayload | undefined;
    if (payload === undefined || payload.kind !== "cantTargetExtended") continue;
    if (!payload.targetMatches(cardId, game)) continue;
    if (ctx.sourceId !== undefined && !payload.sourceMatches(ctx.sourceId, game)) continue;
    if (ctx.activatorSeat !== undefined && !payload.activatorMatches(ctx.activatorSeat)) continue;
    if (ctx.saKind !== undefined && !payload.saKindMatches(ctx.saKind)) continue;
    return false;
  }
  return true;
};

/**
 * True iff `attackerId` may attack without an unpaid Unless cost. False
 * iff any active CantAttackUnless static matches the attacker. The MVP
 * treats the Unless cost as unpaid by default — so "false" means the
 * attack is gated until full cost-payment integration lands.
 *
 * The optional `defenderHint` reserved for forward-compat with the
 * Target$ filter (Propaganda's "attacking you" carve-out). Renamed to
 * `_defenderHint` to suppress TS6133 unused-parameter complaints
 * while keeping the public 3-arity signature stable.
 */
export const canAttackUnlessPaid = (
  game: Game,
  attackerId: EntityId,
  _defenderHint?: EntityId | PlayerSeat,
): boolean => {
  const statics = game.staticEffectRegistry.byMode("CantAttackUnless");
  for (const s of statics) {
    const r = s.describe() as Restriction;
    const payload = r.payload as CantAttackUnlessPayload | undefined;
    if (payload === undefined || payload.kind !== "cantAttackUnlessExtended") continue;
    if (payload.cardMatches(attackerId, game)) return false;
  }
  return true;
};

/**
 * True iff `cardId` should use its toughness instead of its power for
 * combat-damage purposes. False iff no active CombatDamageToughness
 * static matches the card. Consumed by attackerPower (combat/damage-
 * assignment-helpers.ts) which swaps the layered chars value on match.
 */
export const usesToughnessForCombatDamage = (game: Game, cardId: EntityId): boolean => {
  const statics = game.staticEffectRegistry.byMode("CombatDamageToughness");
  for (const s of statics) {
    const payload = s.describe() as CombatDamageToughnessPayload;
    if (payload.cardMatches(cardId, game)) return true;
  }
  return false;
};
