// SPDX-License-Identifier: GPL-3.0-or-later
// CombatHandler — the SOLE mutator of CombatState per the master spec's
// three-mutators architecture (GameAction / CombatHandler / subsystem-internal).
// GameAction must not touch CombatState directly. SP1 exposed the mutation
// surface; SP2 Task 46 adds dealDamage(isFirstStrikeStep) — a generator that
// walks attackers + blockers and emits damage events through GameAction.damage
// (which routes through the replacement chain). Tasks 47 and 48 extend this
// with full lethal+trample+deathtouch assignment validation and the
// first-strike / double-strike step split (CR 702.7 / 702.4).
import type { EntityId, PlayerSeat } from "@mtg-forge-ts/core";
import type { EngineYield } from "../action/engine-yield.js";
import type { Game } from "../game.js";
import type { AttackerInfo, BlockerInfo, CombatState, DefenderTarget } from "./combat-state.js";
import { createCombatState } from "./combat-state.js";
import { attackerPower, defenderId, defenderKind } from "./damage-assignment-helpers.js";

interface DamageOut {
  readonly targetKind: "creature" | "player" | "planeswalker" | "battle";
  readonly targetId: EntityId | PlayerSeat;
  readonly amount: number;
}

export class CombatHandler {
  readonly state: CombatState = createCombatState();

  constructor(private readonly game: Game) {}

  declareAttackers(decls: readonly { attackerId: EntityId; defender: DefenderTarget }[]): void {
    for (const d of decls) {
      const info: AttackerInfo = { attackerId: d.attackerId, defender: d.defender, isTapped: false };
      this.state.attackers.set(d.attackerId, info);
    }
  }

  declareBlockers(decls: readonly { blockerId: EntityId; attackerIds: readonly EntityId[] }[]): void {
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
  }

  /**
   * CR 510 combat damage step. Walks attackers in declaration order, then
   * blockers, emitting damage events through GameAction.damage. The latter
   * routes through the replacement chain and mutates Card.damage /
   * Player.life downstream (and fires DamageDealt triggers).
   *
   * Task 46 scope (this commit):
   *   - Unblocked attacker: whole power to declared defender.
   *   - Blocked attacker with caller-declared damageAssignments: emit those.
   *   - Blocked attacker without caller-declared assignments: simple
   *     defaults (all power to the first ordered blocker). Task 47 replaces
   *     this with the lethal+trample+deathtouch validator-backed default.
   *   - Blocker: deals power to the first attacker it blocks. Banding /
   *     multi-attacker blocker damage ordering is deferred to SP3 Task 51.
   *
   * `isFirstStrikeStep` is accepted for the step split but Task 46 treats
   * all creatures as non-first-strike (emits no damage in FS step). Task
   * 48 replaces isActiveInStep with real keyword-aware logic.
   */
  *dealDamage(isFirstStrikeStep: boolean): Generator<EngineYield, void, unknown> {
    for (const [attackerId, info] of this.state.attackers) {
      if (!this.isActiveInStep(attackerId, isFirstStrikeStep)) continue;
      const power = attackerPower(this.game, attackerId);
      if (power <= 0) continue;
      const blockers = this.state.blockerOrdering.get(attackerId) ?? [];
      if (blockers.length === 0) {
        const d = info.defender;
        yield* this.game.action.damage(attackerId, defenderKind(d), defenderId(d), power, true);
      } else {
        const preDeclared = this.state.damageAssignments.get(attackerId);
        const outs: readonly DamageOut[] =
          preDeclared && preDeclared.length > 0
            ? preDeclared.map((a) => ({
                targetKind: "creature" as const,
                targetId: a.targetId,
                amount: a.amount,
              }))
            : this.defaultAssignment(blockers, power);
        for (const a of outs) {
          yield* this.game.action.damage(attackerId, a.targetKind, a.targetId, a.amount, true);
        }
      }
    }

    for (const [blockerId, info] of this.state.blockers) {
      if (!this.isActiveInStep(blockerId, isFirstStrikeStep)) continue;
      const power = attackerPower(this.game, blockerId);
      if (power <= 0) continue;
      const primaryAttacker = info.attackerIds[0];
      if (primaryAttacker === undefined) continue;
      yield* this.game.action.damage(blockerId, "creature", primaryAttacker, power, true);
    }
  }

  /**
   * Task 46 stand-in for Task 47's validator-backed default. Assigns all
   * power to the first ordered blocker — legal under CR 702.17c so long
   * as the first blocker's lethal is at most `power` (which is trivially
   * true when assigning all of power to it). Task 47 overwrites with the
   * full lethal+trample+deathtouch logic.
   */
  private defaultAssignment(blockers: readonly EntityId[], power: number): readonly DamageOut[] {
    const first = blockers[0];
    if (first === undefined) return [];
    return [{ targetKind: "creature", targetId: first, amount: power }];
  }

  /**
   * Task 46 default: no creature is "active" in the first-strike step
   * (returns false); in the regular step, everyone is active. Task 48
   * replaces this with first_strike / double_strike keyword-aware logic.
   */
  private isActiveInStep(_creatureId: EntityId, isFirstStrikeStep: boolean): boolean {
    return !isFirstStrikeStep;
  }
}
