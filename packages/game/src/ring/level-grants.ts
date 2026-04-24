// SPDX-License-Identifier: GPL-3.0-or-later
// CR 701.52 — Ring level 1-4 ability grants. SP2 scope: map Ring level to a
// set of SYNTHETIC ability ids (Layer 6 `add` effects' `abilityId` slots);
// SP3 swaps the synthetic ids for concrete keyword / trigger-ability records
// once the keyword grant system lands. The ids themselves are stable
// placeholders under the 9000-range so downstream layer consumers can
// pattern-match them without colliding with real ability ids.
//
// Level semantics (cumulative):
//   L1: bearer is legendary (CR 701.52d) + can't be blocked by creatures
//       with greater power (CR 701.52d).
//   L2: bearer's attack triggers -1/-1 on a creature its defending player
//       controls until EOT (CR 701.52e).
//   L3: bearer dealing combat damage triggers 3 life loss on each opponent
//       (CR 701.52f).
//   L4: bearer attack triggers +1/+1 until EOT + the Ring-bearer can't be
//       countered + can't be targeted by opponents' spells/abilities
//       (CR 701.52g / h / i).
//
// SP2 grants these via RingGrantLedger — a per-seat Layer 6 contribution
// that's torn down + re-applied on every tempt (level change OR bearer
// swap). Grants are scoped to the bearer card via Layer 6's targetCardId.
//
// Forge reference: CardFactoryUtil's THE_RING / tempt hooks.
import { type EntityId, mkEntityId } from "@mtg-forge-ts/core";
import type { PlayerSeat } from "@mtg-forge-ts/core";
import type { Game } from "../game.js";
import type { AbilityChangeEffect } from "../layers/layer6-ability.js";
import type { RingLevel } from "./ring-state.js";

/**
 * Synthetic ability ids granted by Ring-level contributions. Stable literal
 * ids so tests can assert on specific grants without threading through the
 * (SP3-future) real ability records. The range 9001-9007 is reserved for
 * the Ring-bearer grant table; the source id 9000 tags the virtual "Ring"
 * source card.
 */
export const RING_LEVEL_ABILITY_IDS = {
  L1_LEGENDARY: mkEntityId(9001),
  L1_UNBLOCKABLE_BY_GREATER: mkEntityId(9002),
  L2_ATTACK_DEBUFF: mkEntityId(9003),
  L3_DAMAGE_LIFE_LOSS: mkEntityId(9004),
  L4_ATTACK_PUMP: mkEntityId(9005),
  L4_UNCOUNTERABLE: mkEntityId(9006),
  L4_UNTARGETABLE_BY_OPPONENT: mkEntityId(9007),
} as const;

export const RING_SOURCE_ID: EntityId = mkEntityId(9000);

/**
 * Map a level to the cumulative set of synthetic ability ids granted to
 * the current Ring-bearer. Level 0 is the null set (no temptation yet).
 */
export const abilityIdsForLevel = (level: RingLevel): readonly EntityId[] => {
  switch (level) {
    case 0:
      return [];
    case 1:
      return [RING_LEVEL_ABILITY_IDS.L1_LEGENDARY, RING_LEVEL_ABILITY_IDS.L1_UNBLOCKABLE_BY_GREATER];
    case 2:
      return [
        RING_LEVEL_ABILITY_IDS.L1_LEGENDARY,
        RING_LEVEL_ABILITY_IDS.L1_UNBLOCKABLE_BY_GREATER,
        RING_LEVEL_ABILITY_IDS.L2_ATTACK_DEBUFF,
      ];
    case 3:
      return [
        RING_LEVEL_ABILITY_IDS.L1_LEGENDARY,
        RING_LEVEL_ABILITY_IDS.L1_UNBLOCKABLE_BY_GREATER,
        RING_LEVEL_ABILITY_IDS.L2_ATTACK_DEBUFF,
        RING_LEVEL_ABILITY_IDS.L3_DAMAGE_LIFE_LOSS,
      ];
    case 4:
      return [
        RING_LEVEL_ABILITY_IDS.L1_LEGENDARY,
        RING_LEVEL_ABILITY_IDS.L1_UNBLOCKABLE_BY_GREATER,
        RING_LEVEL_ABILITY_IDS.L2_ATTACK_DEBUFF,
        RING_LEVEL_ABILITY_IDS.L3_DAMAGE_LIFE_LOSS,
        RING_LEVEL_ABILITY_IDS.L4_ATTACK_PUMP,
        RING_LEVEL_ABILITY_IDS.L4_UNCOUNTERABLE,
        RING_LEVEL_ABILITY_IDS.L4_UNTARGETABLE_BY_OPPONENT,
      ];
    default: {
      const _: never = level;
      throw new Error(`abilityIdsForLevel: unreachable ${JSON.stringify(_)}`);
    }
  }
};

/**
 * RingGrantLedger — Layer 6 contribution manager for Ring-bearer ability
 * grants. Keyed by player seat because each player has at most one
 * Ring-bearer; when the bearer swaps or the level advances, the whole
 * per-seat set is torn down and rebuilt. This keeps the LayerEngine's
 * abilityEffects array free of stale references.
 *
 * Construction: owned by Game. Populated by tempt() (SP2) and by any
 * future Ring-bearer replacement path (SP3).
 */
export class RingGrantLedger {
  private readonly bySeat = new Map<PlayerSeat, AbilityChangeEffect[]>();

  applyFor(game: Game, seat: PlayerSeat): void {
    this.removeFor(game, seat);
    const state = game.ringState.get(seat);
    if (!state || state.bearer === null || state.level === 0) {
      // No contribution — either untempted, no bearer, or the bearer
      // slot is empty. The removeFor() above already cleared any prior
      // grants; nothing else to do.
      game.layerEngine.bumpEpoch("ring-grant-clear");
      return;
    }
    const ids = abilityIdsForLevel(state.level);
    const bearer = state.bearer;
    const effects: AbilityChangeEffect[] = ids.map((abilityId) => ({
      kind: "add" as const,
      abilityId,
      grantedBy: RING_SOURCE_ID,
      origin: "layer6" as const,
      // Timestamp = level so higher-level grants always sort later than
      // earlier ones within the same seat. Inter-seat ordering doesn't
      // matter for cumulative grants — Layer 6 is commutative for `add`.
      timestamp: state.level,
      targetCardId: bearer,
    }));
    for (const e of effects) game.layerEngine.abilityEffects.push(e);
    this.bySeat.set(seat, effects);
    game.layerEngine.bumpEpoch("ring-grant");
  }

  removeFor(game: Game, seat: PlayerSeat): void {
    const prev = this.bySeat.get(seat);
    if (!prev || prev.length === 0) return;
    // splice by identity — the shared array holds more than just this
    // seat's contributions, so we can't truncate.
    const arr = game.layerEngine.abilityEffects;
    for (const e of prev) {
      const i = arr.indexOf(e);
      if (i >= 0) arr.splice(i, 1);
    }
    this.bySeat.delete(seat);
    game.layerEngine.bumpEpoch("ring-grant-remove");
  }

  /** Test-only inspector: how many effects are currently registered for a seat. */
  sizeFor(seat: PlayerSeat): number {
    return this.bySeat.get(seat)?.length ?? 0;
  }
}
