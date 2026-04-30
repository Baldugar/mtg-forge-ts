// SPDX-License-Identifier: GPL-3.0-or-later
// Wave 70.K — query helpers for the three Wave-70.K static modes:
//   - CantAttach          → canAttach
//   - AttackRequirement   → attackRequirementsFor
//   - IgnoreHexproof      → ignoresHexproof
//
// Each helper walks the staticEffectRegistry by mode and returns a
// single value (boolean / required-defender list) the consumer site
// uses to override the canonical behavior at the matching decision
// point.
//
// Read-side consumers:
//   - canAttach              → action/game-action.ts (attach pre-check)
//                               + keyword/handlers/equip-keyword.ts
//                                 (Equip activation gating, cf. Wave 49)
//                               + keyword/handlers/for-mirrodin-keyword.ts
//                                 (auto-attach static-cause; cf. Wave 62.A)
//   - attackRequirementsFor  → combat/combat-handler.ts declareAttackers
//                               (post-declaration validation)
//   - ignoresHexproof        → target/enumeration.ts
//                               (supplements canBeTargetedBy / hexproof flag)
//
// Why standalone helpers (not methods on Game / Game.flags): mirrors
// Wave 60.A / 60.H / 70.D / 70.E / 70.F / 70.I / 70.J. The static
// registry already snapshots and restores cleanly, so walking the
// registry per-query is the right source of truth — and matches the
// established gate pattern.
import { CardType, type EntityId, type PlayerSeat } from "@mtg-forge-ts/core";
import type { Game } from "../game.js";
import type { AttackRequirementPayload } from "../static/handlers/attack-requirement-static.js";
import type { CantAttachPayload } from "../static/handlers/cant-attach-static.js";
import type { IgnoreHexproofPayload } from "../static/handlers/ignore-hexproof-static.js";

/**
 * True iff the equipment / aura `equipmentId` may be attached to the
 * candidate target `targetId`. False iff any active CantAttach static
 * matches the (equipment, target) pair.
 *
 * Forge equivalent: `StaticAbilityCantAttach.cantAttach(...)` returning
 * a non-null gating static.
 */
export const canAttach = (game: Game, equipmentId: EntityId, targetId: EntityId): boolean => {
  const statics = game.staticEffectRegistry.byMode("CantAttach");
  for (const s of statics) {
    const payload = s.describe() as CantAttachPayload;
    if (!payload || payload.kind !== "cantAttach") continue;
    if (!payload.equipmentMatches(equipmentId, game)) continue;
    if (!payload.targetMatches(targetId, game)) continue;
    return false;
  }
  return true;
};

/**
 * Defender-target shape duck-typed against combat-state's DefenderTarget.
 * We don't pull the full type to keep this helper module decoupled from
 * combat internals — it only needs the discriminator + ID to compare.
 */
export type DefenderRef =
  | { readonly kind: "player"; readonly seat: PlayerSeat }
  | { readonly kind: "planeswalker"; readonly id: EntityId }
  | { readonly kind: "battle"; readonly id: EntityId };

/**
 * Result of attackRequirementsFor:
 *   - `null` when no AttackRequirement static matches the attacker
 *     (no additional requirement applies).
 *   - `{ allowedDefenders }` listing the defender refs the attacker IS
 *     allowed to declare against. The combat validator MUST verify
 *     that the declared defender belongs to this set.
 *
 * The full Forge grammar admits a defender filter that resolves
 * dynamically at declaration time (e.g. "Player.Other" means "any
 * non-controller of the attacker"). We resolve at query time using
 * the live game state — the helper has access to all players +
 * planeswalker permanents.
 */
export interface AttackRequirementResult {
  /** Player seats the attacker may attack (empty if none allowed). */
  readonly allowedSeats: ReadonlySet<PlayerSeat>;
  /** Planeswalker entity ids the attacker may attack (empty if none). */
  readonly allowedPlaneswalkerIds: ReadonlySet<EntityId>;
  /** Battle entity ids the attacker may attack (empty if none). */
  readonly allowedBattleIds: ReadonlySet<EntityId>;
}

/**
 * Resolve the ValidDefender$ filter into the concrete defender set
 * the attacker is allowed to declare against. Each match's filter
 * intersects across the AND of all matching gates: an attacker
 * subject to multiple AttackRequirement statics must satisfy ALL of
 * them simultaneously (CR 509.1c — multiple requirements satisfied
 * to the maximum extent possible). The MVP intersection is per-set.
 *
 * Returns `null` when the attacker is not subject to ANY active
 * AttackRequirement gate (the canonical "no requirement" case).
 */
export const attackRequirementsFor = (game: Game, attackerId: EntityId): AttackRequirementResult | null => {
  const statics = game.staticEffectRegistry.byMode("AttackRequirement");
  if (statics.length === 0) return null;

  let matched = false;
  let allowedSeats: Set<PlayerSeat> | undefined;
  let allowedPlaneswalkerIds: Set<EntityId> | undefined;
  let allowedBattleIds: Set<EntityId> | undefined;

  const attackerCard = game.cards.get(attackerId);
  const attackerControllerSeat = attackerCard?.controllerSeat;

  for (const s of statics) {
    const payload = s.describe() as AttackRequirementPayload;
    if (!payload || payload.kind !== "attackRequirement") continue;
    if (!payload.attackerMatches(attackerId, game)) continue;

    matched = true;
    const filterRaw = payload.validDefenderRaw;
    const staticCtrl = payload.staticControllerSeat;

    // Compute the per-static permitted set, then intersect.
    const seats = new Set<PlayerSeat>();
    const pws = new Set<EntityId>();
    const battles = new Set<EntityId>();

    if (filterRaw === undefined || filterRaw.length === 0) {
      // No defender filter → any defender allowed.
      for (const p of game.players) seats.add(p.seat);
      // Walk all permanents for planeswalker / battle types via layered chars.
      for (const c of game.cards.values()) {
        const chars = game.layerEngine.computeCharacteristics(c.id);
        if (chars.types.has(CardType.Planeswalker)) pws.add(c.id);
        if (chars.types.has(CardType.Battle)) battles.add(c.id);
      }
    } else {
      // Comma-separated tokens — each token contributes to the union.
      const tokens = filterRaw
        .split(",")
        .map((t) => t.trim())
        .filter((t) => t.length > 0);
      for (const tok of tokens) {
        // Player tokens: "You" / "Opponent" / "Player" / "Any" /
        // "Player.Other".
        if (tok === "You") {
          seats.add(staticCtrl);
        } else if (tok === "Opponent") {
          for (const p of game.players) {
            if (p.seat !== staticCtrl) seats.add(p.seat);
          }
        } else if (tok === "Player" || tok === "Any") {
          for (const p of game.players) seats.add(p.seat);
        } else if (tok === "Player.Other") {
          // "Player other than the attacker's controller" — common Goad
          // shape. Resolves against the attacker's live controller.
          if (attackerControllerSeat !== undefined) {
            for (const p of game.players) {
              if (p.seat !== attackerControllerSeat) seats.add(p.seat);
            }
          }
        } else if (tok.startsWith("Planeswalker")) {
          // "Planeswalker.YouCtrl" / "Planeswalker.OppCtrl" / "Planeswalker".
          for (const c of game.cards.values()) {
            const chars = game.layerEngine.computeCharacteristics(c.id);
            if (!chars.types.has(CardType.Planeswalker)) continue;
            if (tok === "Planeswalker") {
              pws.add(c.id);
            } else if (tok === "Planeswalker.YouCtrl") {
              if (c.controllerSeat === staticCtrl) pws.add(c.id);
            } else if (tok === "Planeswalker.OppCtrl") {
              if (c.controllerSeat !== staticCtrl) pws.add(c.id);
            }
          }
        } else if (tok.startsWith("Battle")) {
          for (const c of game.cards.values()) {
            const chars = game.layerEngine.computeCharacteristics(c.id);
            if (chars.types.has(CardType.Battle)) battles.add(c.id);
          }
        }
        // Other tokens fall through (conservative reject — TODO(advanced)).
      }
    }

    // Intersect with the running result. First match seeds the sets;
    // subsequent matches narrow them.
    if (allowedSeats === undefined) {
      allowedSeats = seats;
      allowedPlaneswalkerIds = pws;
      allowedBattleIds = battles;
    } else {
      for (const v of [...allowedSeats]) if (!seats.has(v)) allowedSeats.delete(v);
      if (allowedPlaneswalkerIds !== undefined) {
        for (const v of [...allowedPlaneswalkerIds]) {
          if (!pws.has(v)) allowedPlaneswalkerIds.delete(v);
        }
      }
      if (allowedBattleIds !== undefined) {
        for (const v of [...allowedBattleIds]) {
          if (!battles.has(v)) allowedBattleIds.delete(v);
        }
      }
    }
  }

  if (!matched) return null;
  return {
    allowedSeats: allowedSeats ?? new Set(),
    allowedPlaneswalkerIds: allowedPlaneswalkerIds ?? new Set(),
    allowedBattleIds: allowedBattleIds ?? new Set(),
  };
};

/**
 * True iff the declared defender ref is permitted by the
 * AttackRequirement result. A `null` result (no requirement applies)
 * trivially permits any defender.
 */
export const isDefenderPermitted = (
  result: AttackRequirementResult | null,
  defender: DefenderRef,
): boolean => {
  if (result === null) return true;
  switch (defender.kind) {
    case "player":
      return result.allowedSeats.has(defender.seat);
    case "planeswalker":
      return result.allowedPlaneswalkerIds.has(defender.id);
    case "battle":
      return result.allowedBattleIds.has(defender.id);
    default: {
      const _: never = defender;
      throw new Error(`isDefenderPermitted: unreachable ${JSON.stringify(_)}`);
    }
  }
};

/**
 * True iff the casting source `sourceId` (with optional candidate
 * target `targetId`) bypasses hexproof per any active IgnoreHexproof
 * static. False (the canonical default) iff no matching static is in
 * force.
 *
 * The targetId is optional because some consumers consult the gate
 * before they know the candidate target (e.g. early enumeration).
 * Without a target, the per-static ValidCard$ filter is treated as
 * "match" (the gate is potentially-active for any target).
 */
export const ignoresHexproof = (game: Game, sourceId: EntityId, targetId?: EntityId): boolean => {
  const statics = game.staticEffectRegistry.byMode("IgnoreHexproof");
  for (const s of statics) {
    const payload = s.describe() as IgnoreHexproofPayload;
    if (!payload || payload.kind !== "ignoreHexproof") continue;
    if (!payload.sourceMatches(sourceId, game)) continue;
    if (targetId !== undefined && !payload.targetMatches(targetId, game)) continue;
    return true;
  }
  return false;
};
