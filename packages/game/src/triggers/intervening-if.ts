// SPDX-License-Identifier: GPL-3.0-or-later
// CR 603.4 — "When X, if Y, do Z" triggers check Y twice: at trigger time
// (Task 20's TriggerRegistry.onEvent already enforces this) AND at
// resolve time (this helper). If the condition is false at resolve, the
// effect does nothing — the triggered ability's resolution is essentially
// a no-op for the game-state-mutation side, though it still consumes its
// stack slot normally.
//
// Consumed by Task 67's resolveStackItem for triggered-ability items.
// Re-exported from packages/game/src/triggers/index.ts so resolver code
// outside the triggers module (SP3+ effect handlers) can import it
// without reaching into internals.
import type { GameEvent, TriggeredAbility } from "@mtg-forge-ts/core";
import type { Game } from "../game.js";

export const interveningIfStillTrue = (trigger: TriggeredAbility, event: GameEvent, game: Game): boolean => {
  if (!trigger.interveningIf) return true;
  return trigger.interveningIf(event, game);
};
