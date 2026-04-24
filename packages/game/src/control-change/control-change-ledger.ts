// SPDX-License-Identifier: GPL-3.0-or-later
// SP2 Milestone L Task 45 — time-bounded control change bookkeeping.
//
// When GameAction.changeControl is called with `opts.until` pointing at
// an EffectDuration, the ledger records:
//   - the prior controller (so the game can revert when the duration
//     fires), and
//   - the duration predicate itself.
//
// The ledger is event-driven: Game.emitEvent feeds every canonical event
// into ControlChangeLedger.onEvent. Each matching entry's cardId is
// returned so the caller (Game.emitEvent, downstream of the trigger /
// delayed-trigger feed) can emit a reverting changeControl.
//
// WHY a separate class (not re-using the ContinuousEffectRegistry):
// control change is Layer 2 — not a characteristic mutation but a
// direct Card.controllerSeat write. The continuous-effect registry is
// characteristic-payload-shaped; a control-reversion effect would have
// to reach outside the layer pipeline to write the card. Keeping this
// in its own lightweight ledger avoids reshaping either registry.
//
// Forge reference: ControlChangeEffect's explicit handling in
// StaticAbilityContinuous + AbilityUtils (layer 2, ungatedBy duration).
import type { EffectDuration, EntityId, GameEvent, PlayerSeat } from "@mtg-forge-ts/core";
import { ZoneType } from "@mtg-forge-ts/core";

interface LedgerEntry {
  readonly priorController: PlayerSeat;
  readonly duration: EffectDuration;
  readonly registeredAtTurn: number;
}

export class ControlChangeLedger {
  private readonly entries = new Map<EntityId, LedgerEntry>();

  record(
    cardId: EntityId,
    priorController: PlayerSeat,
    duration: EffectDuration,
    registeredAtTurn: number,
  ): void {
    this.entries.set(cardId, { priorController, duration, registeredAtTurn });
  }

  forget(cardId: EntityId): void {
    this.entries.delete(cardId);
  }

  get(cardId: EntityId): Readonly<LedgerEntry> | undefined {
    return this.entries.get(cardId);
  }

  /**
   * Evaluate every ledger entry against `event`; return ids whose
   * control should revert. The caller is responsible for issuing the
   * actual changeControl + forget() pair.
   *
   * WHY return instead of mutate: Game.emitEvent is not a generator —
   * it can't yield* into GameAction.changeControl. It queues the
   * reversions on the game for the next priority sweep to apply.
   */
  expiredOn(event: GameEvent): readonly EntityId[] {
    const out: EntityId[] = [];
    for (const [cardId, entry] of this.entries) {
      if (this.matches(entry, event)) out.push(cardId);
    }
    return out;
  }

  private matches(entry: LedgerEntry, event: GameEvent): boolean {
    const d = entry.duration;
    switch (d.kind) {
      case "permanent":
        return false;
      case "untilEndOfTurn":
        return event.kind === "TurnEnded";
      case "untilEndOfYourNextTurn": {
        if (event.kind !== "TurnEnded") return false;
        if (event.payload.activeSeat !== d.forSeat) return false;
        // Effects registered DURING forSeat's own turn survive that
        // turn's end and expire the next time forSeat's turn ends.
        return event.turn > entry.registeredAtTurn;
      }
      case "untilXLeavesBattlefield": {
        if (event.kind !== "CardChangedZone") return false;
        return event.payload.cardId === d.xId && event.payload.fromZone === ZoneType.Battlefield;
      }
      case "untilCombatEnds":
        return event.kind === "CombatEnded";
      case "untilEndOfNextStep": {
        if (event.kind !== "PhaseStepEnded") return false;
        return event.payload.step === d.step;
      }
      case "asLongAs":
        // asLongAs is condition-AST driven; the continuous-effect
        // registry is the better home for that variant. If a caller
        // passes asLongAs here the ledger treats it as permanent;
        // callers should wrap it in a ContinuousEffect instead.
        return false;
      default: {
        const _: never = d;
        throw new Error(`ControlChangeLedger.matches: unreachable ${JSON.stringify(_)}`);
      }
    }
  }
}
