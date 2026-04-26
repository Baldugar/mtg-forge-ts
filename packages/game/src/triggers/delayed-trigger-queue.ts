// SPDX-License-Identifier: GPL-3.0-or-later
// CR 603.7 — delayed triggers. Created by a resolving effect; fire on a
// later triggering event. one-shot = fire-and-remove; non-one-shot =
// stays in queue after each fire (e.g., "At the beginning of each end
// step this turn, …").
//
// The queue observes every event emitted by GameAction via its own
// onEvent hook (Game.emitEvent routes to both TriggerRegistry AND this
// queue). When a delayed trigger matches, it's forwarded to the
// TriggerRegistry's pending via onEventForcedByDelayed (which still
// honors intervening-if + captureLki + suppression).
import type { DelayedTrigger, GameEvent } from "@mtg-forge-ts/core";
import { ZoneType } from "@mtg-forge-ts/core";
import type { Game } from "../game.js";
import type { TriggerRegistry } from "./trigger-registry.js";

export class DelayedTriggerQueue {
  private readonly queue: DelayedTrigger[] = [];

  // Game reference lets us honor CR 702.26e — phased-out sources don't
  // trigger on most events. Optional for snapshot restore paths that
  // construct the queue without a live Game; when absent the phased gate
  // simply doesn't fire (matches the pre-audit behavior).
  constructor(private readonly game?: Game) {}

  add(d: DelayedTrigger): void {
    this.queue.push(d);
  }

  remove(d: DelayedTrigger): void {
    const i = this.queue.indexOf(d);
    if (i >= 0) this.queue.splice(i, 1);
  }

  snapshot(): readonly DelayedTrigger[] {
    return [...this.queue];
  }

  size(): number {
    return this.queue.length;
  }

  /**
   * Walk the queue in reverse so one-shot removals don't skip entries.
   * For each delayed trigger that matches the event, forward to the
   * TriggerRegistry (which re-checks suppression + intervening-if +
   * captureLki). Removal of one-shot triggers happens regardless of
   * whether the TriggerRegistry actually queued a pending — "fire" here
   * means "the delayed trigger's matches predicate returned true", and
   * one-shot semantics per CR 603.7a-b say the delayed trigger is
   * discarded after firing even if a suppression effect vetoed the
   * pending.
   */
  onEvent(event: GameEvent, sink: TriggerRegistry): void {
    // CR 702.26e — phased-out sources don't observe most events; apply
    // the same non-zone-change gate as TriggerRegistry.onEvent. Audit I-15.
    const isLeavingBattlefield =
      event.kind === "CardChangedZone" && event.payload.fromZone === ZoneType.Battlefield;
    for (let i = this.queue.length - 1; i >= 0; i--) {
      const d = this.queue[i];
      if (!d) continue;
      if (!d.matches(event)) continue;
      // Audit I-8 — CR 603.10c suppression: when the delayed trigger is
      // explicitly tagged as host-leaving-suppressed (e.g. "at end of turn,
      // sacrifice CARDX" — if the source card has left the battlefield,
      // the trigger can't fire because it has no live host to act on),
      // gate on the source's continued battlefield presence.
      // The flag is set by trigger-creating effects that need this
      // semantics; default false preserves prior behavior for delayed
      // triggers that should fire regardless (CR 603.7c general case).
      const suppressOnHostLeave =
        (d as unknown as { suppressOnHostLeave?: boolean }).suppressOnHostLeave === true;
      if (suppressOnHostLeave && this.game) {
        const sourceCard = this.game.cards.get(d.sourceCardId);
        if (!sourceCard || sourceCard.zone !== ZoneType.Battlefield) {
          // Source has left the battlefield (or no longer exists). Drop the
          // one-shot; persistent triggers stay so they can fire if the host
          // somehow re-enters.
          if (d.oneShot) this.queue.splice(i, 1);
          continue;
        }
      }
      if (this.game && !isLeavingBattlefield) {
        const sourceCard = this.game.cards.get(d.sourceCardId);
        if (sourceCard?.phased === true) {
          // Source phased-out and event isn't a leave-battlefield — skip
          // fire. Do NOT remove a one-shot trigger here: it should fire
          // when its source is no longer phased-out if the triggering
          // condition recurs.
          continue;
        }
      }
      sink.onEventForcedByDelayed(d, event);
      if (d.oneShot) this.queue.splice(i, 1);
    }
  }

  clear(): void {
    this.queue.length = 0;
  }
}
