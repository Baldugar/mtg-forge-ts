// SPDX-License-Identifier: GPL-3.0-or-later
// CombatHandler — the SOLE mutator of CombatState per the master spec's
// three-mutators architecture (GameAction / CombatHandler / subsystem-internal).
// GameAction must not touch CombatState directly. SP1 exposes the mutation
// surface so Task 49's integration smoke test can construct attacker state;
// actual damage-dealing + trigger firing is SP2's `dealDamage` generator.
import type { EntityId } from "@mtg-forge-ts/core";
import type { Game } from "../game.js";
import type { AttackerInfo, BlockerInfo, CombatState, DefenderTarget } from "./combat-state.js";
import { createCombatState } from "./combat-state.js";

export class CombatHandler {
  readonly state: CombatState = createCombatState();

  constructor(private readonly game: Game) {
    // `game` is retained so SP2 can consult Game when dealing damage and
    // firing triggers. Reference unused at SP1 scaffold level.
    void this.game;
  }

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
}
