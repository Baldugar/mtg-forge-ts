// SPDX-License-Identifier: GPL-3.0-or-later
// A PendingTrigger is a trigger that has fired but not yet drained to the
// stack. It carries the triggering event, an LKI snapshot of the source
// card at fire time (so "return that creature" still works after it's
// moved zones), and the source's controller at fire time (which may be
// different from current controller if control changes between fire and
// resolve).
//
// Tasks 20-24 produce these; Task 40 (priority orchestrator) drains them.
import type { EntityId, GameEvent, LastKnownInfo, PhaseStep, PlayerSeat } from "@mtg-forge-ts/core";

export interface PendingTrigger {
  readonly id: EntityId;
  readonly triggerId: EntityId;
  readonly sourceCardId: EntityId;
  readonly event: GameEvent;
  readonly lki: LastKnownInfo | null;
  readonly sourceControllerAtFire: PlayerSeat;
  readonly firedAtTurn: number;
  readonly firedAtPhase: PhaseStep;
}
