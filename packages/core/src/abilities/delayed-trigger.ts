// SPDX-License-Identifier: GPL-3.0-or-later
// CR 603.7 — delayed trigger (created by a resolving effect, fires later).
// Tasks 22-23 implement the queue.
import type { GameEvent } from "../events/event.js";
import type { AbilityBase } from "./active-ability.js";

export interface DelayedTrigger extends AbilityBase {
  readonly kind: "triggered";
  readonly isDelayed: true;
  readonly createdAtTurn: number;
  // Context captured at creation — target ids, sourced values, etc. SP3
  // populates with strongly-typed records per effect.
  readonly creationContext: Readonly<Record<string, unknown>>;
  // Most delayed triggers fire at most once; some ("At the beginning of each
  // end step…") fire repeatedly. oneShot controls which the queue's drain
  // behavior follows.
  readonly oneShot: boolean;
  matches(event: GameEvent): boolean;
}
