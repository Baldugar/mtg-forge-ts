// SPDX-License-Identifier: GPL-3.0-or-later
// CR 603 — triggered ability shape. Tasks 20-24 implement the registry;
// this type is consumed there.
import type { GameEvent } from "../events/event.js";
import type { EntityId } from "../ids.js";
import type { AbilityBase } from "./active-ability.js";

export interface TriggeredAbility extends AbilityBase {
  readonly kind: "triggered";
  // Primary gate — does this event cause the trigger to fire?
  matches(event: GameEvent): boolean;
  // CR 603.4 intervening-if — evaluated at fire time AND at resolve time.
  // Optional: triggers without a when-condition omit this.
  interveningIf?(event: GameEvent, game: unknown): boolean;
  // Trigger-time snapshot — captures LKI for leaves/dies-triggers.
  // Optional: simple triggers may not need to freeze context.
  captureLki?(event: GameEvent, game: unknown): unknown;
  // CR 607 linked abilities — if present, this trigger references data
  // tied to another ability instance (e.g., "return the exiled card").
  readonly linkedTo?: EntityId;
  // Distinguishes real triggered abilities from delayed-trigger instances.
  readonly isDelayed: boolean;
}
