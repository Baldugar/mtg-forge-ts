// SPDX-License-Identifier: GPL-3.0-or-later
// CombatHandler — the SOLE mutator of CombatState per the master spec's
// three-mutators architecture (GameAction / CombatHandler / subsystem-internal).
// GameAction must not touch CombatState directly. SP1 exposed the mutation
// surface; SP2 Task 46 added dealDamage(isFirstStrikeStep); Task 47 layered
// in lethal+trample+deathtouch validation (damage-assignment-validator.ts);
// Task 48 adds the first-strike / double-strike step split per CR 702.7 /
// 702.4:
//   - FS step: only creatures with first_strike or double_strike deal damage.
//   - Regular step: creatures without first_strike (first hit) PLUS creatures
//     with double_strike (second hit). First-strike-only creatures that
//     already dealt in the FS step do not deal again.
//
// `runCombatDamage()` drives the full split when any combatant has FS or DS;
// otherwise it falls through to a single dealDamage(false) call.
import { type EntityId, IllegalDecisionError, type PlayerSeat } from "@mtg-forge-ts/core";
import type { EngineYield } from "../action/engine-yield.js";
import { onCombatDamageToPlayer as onCombatDamageInitiative } from "../dnd/initiative-tracker.js";
import type { Game } from "../game.js";
import { onCombatDamageToPlayer as onCombatDamageMonarch } from "../monarch/monarch-tracker.js";
import type { AttackerInfo, BlockerInfo, CombatState, DefenderTarget } from "./combat-state.js";
import { createCombatState } from "./combat-state.js";
import {
  attackerPower,
  defenderId,
  defenderKind,
  hasKeyword,
  isPhasedOut,
} from "./damage-assignment-helpers.js";
import { type CombatDamageAssignment, defaultAssignment } from "./damage-assignment-validator.js";
import { validateBlockDeclarations } from "./keywords/block-restrictions.js";

export class CombatHandler {
  readonly state: CombatState = createCombatState();

  // CR 702.4 / 702.7 — creatures that dealt damage in the first-strike step.
  // The regular step suppresses first-strike-only creatures that already
  // dealt (invariant holds trivially when nothing strips FS mid-combat, but
  // we track it so a SP3 layered FS-removal effect between the two steps
  // cannot cause a FS-only creature to double-hit).
  private readonly dealtFirstStrike = new Set<EntityId>();

  constructor(private readonly game: Game) {}

  declareAttackers(decls: readonly { attackerId: EntityId; defender: DefenderTarget }[]): void {
    for (const d of decls) {
      const info: AttackerInfo = { attackerId: d.attackerId, defender: d.defender, isTapped: false };
      this.state.attackers.set(d.attackerId, info);
    }
  }

  declareBlockers(decls: readonly { blockerId: EntityId; attackerIds: readonly EntityId[] }[]): void {
    // Audit I-13 — validate block restrictions (flying, reach, menace,
    // landwalk, protection, etc.) before storing declarations. Illegal
    // blocks throw IllegalDecisionError with the per-declaration reason.
    const illegal = validateBlockDeclarations(this.game, decls);
    if (illegal.length > 0) {
      const reasons = illegal.map((r) => r.reason ?? "unknown block restriction").join("; ");
      throw new IllegalDecisionError(`declareBlockers: ${reasons}`);
    }
    for (const d of decls) {
      const info: BlockerInfo = { blockerId: d.blockerId, attackerIds: [...d.attackerIds] };
      this.state.blockers.set(d.blockerId, info);
    }
  }

  setBlockerOrder(attackerId: EntityId, blockerOrder: readonly EntityId[]): void {
    this.state.blockerOrdering.set(attackerId, [...blockerOrder]);
  }

  assignDamage(attackerId: EntityId, assignments: readonly { targetId: EntityId; amount: number }[]): void {
    this.state.damageAssignments.set(attackerId, [...assignments]);
  }

  setFirstStrikeSplit(active: boolean): void {
    this.state.firstStrikeSplitActive = active;
  }

  clear(): void {
    this.state.attackers.clear();
    this.state.blockers.clear();
    this.state.blockerOrdering.clear();
    this.state.damageAssignments.clear();
    this.state.firstStrikeSplitActive = false;
    this.dealtFirstStrike.clear();
  }

  /**
   * CR 510 combat damage step. Walks attackers in declaration order, then
   * blockers, emitting damage events through GameAction.damage. The latter
   * routes through the replacement chain and mutates Card.damage /
   * Player.life downstream (and fires DamageDealt triggers).
   *
   *   - Unblocked attacker: whole power to declared defender.
   *   - Blocked attacker with caller-declared damageAssignments: emit those.
   *   - Blocked attacker without: `defaultAssignment` (Task 47).
   *   - Blocker: deals power to the first attacker it blocks. Banding /
   *     multi-attacker blocker damage ordering is deferred to SP3 Task 51.
   *
   * Step participation is decided by `isActiveInStep`. Prefer calling
   * `runCombatDamage()` at the combat-damage step boundary rather than
   * invoking this directly — runCombatDamage conditionally runs the FS
   * step and maintains the firstStrikeSplitActive flag.
   */
  *dealDamage(isFirstStrikeStep: boolean): Generator<EngineYield, void, unknown> {
    for (const [attackerId, info] of this.state.attackers) {
      if (!this.isActiveInStep(attackerId, isFirstStrikeStep)) continue;
      // CR 702.26e — phased-out creatures deal and receive no damage
      // during combat. The declaration lists (attackers/blockers) may still
      // hold the id if a prior step phased the creature out mid-combat;
      // silently skip rather than blow away state so un-phasing restores
      // the combat role cleanly.
      if (isPhasedOut(this.game, attackerId)) continue;
      const power = attackerPower(this.game, attackerId);
      if (power <= 0) continue;
      const blockers = this.state.blockerOrdering.get(attackerId) ?? [];
      if (blockers.length === 0) {
        const d = info.defender;
        const dKind = defenderKind(d);
        const dId = defenderId(d);
        yield* this.game.action.damage(attackerId, dKind, dId, power, true);
        // Wave 27 — Initiative + Monarch combat-damage transfer (CR 506.4 /
        // 716 / 906). When an attacker deals damage to a player, check if
        // that player is the current monarch / initiative-holder; if so
        // transfer to the attacker's controller. Per CR 506.4 the transfer
        // happens AFTER damage resolves, so we run it post-yield. Triggers
        // observing BecameMonarch / BecameInitiative will see the new state
        // when they resolve.
        if (dKind === "player") {
          yield* this.applyCombatTransfers(attackerId, dId as PlayerSeat, power);
        }
      } else {
        const preDeclared = this.state.damageAssignments.get(attackerId);
        const outs: readonly CombatDamageAssignment[] =
          preDeclared && preDeclared.length > 0
            ? preDeclared.map((a) => ({
                targetKind: "creature" as const,
                targetId: a.targetId,
                amount: a.amount,
              }))
            : defaultAssignment(this.game, attackerId, blockers, power, info.defender);
        for (const a of outs) {
          yield* this.game.action.damage(attackerId, a.targetKind, a.targetId, a.amount, true);
        }
      }
      if (isFirstStrikeStep) this.dealtFirstStrike.add(attackerId);
    }

    for (const [blockerId, info] of this.state.blockers) {
      if (!this.isActiveInStep(blockerId, isFirstStrikeStep)) continue;
      // CR 702.26e — phased-out blockers don't deal damage either.
      if (isPhasedOut(this.game, blockerId)) continue;
      const power = attackerPower(this.game, blockerId);
      if (power <= 0) continue;
      const primaryAttacker = info.attackerIds[0];
      if (primaryAttacker === undefined) continue;
      yield* this.game.action.damage(blockerId, "creature", primaryAttacker, power, true);
      if (isFirstStrikeStep) this.dealtFirstStrike.add(blockerId);
    }
  }

  /**
   * Drive the full combat damage step with the CR 702.7 / 702.4 split. If
   * any attacker or blocker has first_strike or double_strike, run a FS
   * step (firstStrikeSplitActive=true) followed by the regular step;
   * otherwise skip the FS step entirely and run only the regular step.
   */
  *runCombatDamage(): Generator<EngineYield, void, unknown> {
    const needsFSStep =
      [...this.state.attackers.keys()].some((id) => this.hasFSorDS(id)) ||
      [...this.state.blockers.keys()].some((id) => this.hasFSorDS(id));
    if (needsFSStep) {
      this.setFirstStrikeSplit(true);
      yield* this.dealDamage(true);
      this.setFirstStrikeSplit(false);
    }
    yield* this.dealDamage(false);
  }

  /**
   * Wave 27 — yield Initiative + Monarch transfer events when an attacker
   * dealt combat damage to a player. The trackers' helpers compute the
   * transfer + mutate game.flags; we just emit the resulting events
   * through the canonical pipeline so triggers see them.
   */
  private *applyCombatTransfers(
    sourceId: EntityId,
    targetSeat: PlayerSeat,
    amount: number,
  ): Generator<EngineYield, void, unknown> {
    for (const evt of onCombatDamageInitiative(this.game, sourceId, targetSeat, amount)) {
      yield this.game.emitEvent(evt);
    }
    for (const evt of onCombatDamageMonarch(this.game, sourceId, targetSeat, amount)) {
      yield this.game.emitEvent(evt);
    }
  }

  private hasFSorDS(creatureId: EntityId): boolean {
    return (
      hasKeyword(this.game, creatureId, "first_strike") || hasKeyword(this.game, creatureId, "double_strike")
    );
  }

  /**
   * CR 702.7 / 702.4 step participation.
   *   - FS step: only creatures with first_strike or double_strike
   *     participate.
   *   - Regular step: double-strikers (second hit) and non-first-strike
   *     creatures (first hit) both participate. First-strike-only
   *     creatures that already dealt their FS-step damage do not double-
   *     hit (suppressed via dealtFirstStrike).
   *
   * Edge case: if someone calls dealDamage(false) directly without a
   * prior FS step, a first_strike-only creature falls through to the
   * regular step — best-effort, matches Forge's defensive behavior.
   */
  private isActiveInStep(creatureId: EntityId, isFirstStrikeStep: boolean): boolean {
    const hasFS = hasKeyword(this.game, creatureId, "first_strike");
    const hasDS = hasKeyword(this.game, creatureId, "double_strike");
    if (isFirstStrikeStep) {
      return hasFS || hasDS;
    }
    if (hasDS) return true;
    if (hasFS) {
      // First-strike only. Skip if already dealt in FS step; otherwise
      // fall through (caller used dealDamage(false) without a prior FS
      // pass).
      return !this.dealtFirstStrike.has(creatureId);
    }
    return true;
  }
}
