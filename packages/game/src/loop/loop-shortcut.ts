// SPDX-License-Identifier: GPL-3.0-or-later
// CR 725 — loop detection + shortcut.
//
// Engine primitive. The consumer (SP5 AI; human PlayerController UI)
// detects that a sequence of actions forms a rules-driven loop and
// requests a shortcut directly to the loop's terminal state. The engine's
// role here is:
//   - Validate the description is well-formed.
//   - Emit ShortcutApplied carrying the description and the list of
//     affected EntityIds.
//
// Actual loop detection + final-state computation is the consumer's
// responsibility (SP5). SP2 exposes this primitive so the priority
// orchestrator (Task 41) can accept a `requestShortcut` PriorityAction
// and dispatch to this generator. The `result.finalState` slot is opaque
// here — future work applies it to Game; SP2 records the shortcut event
// and trusts the consumer.
import { type EntityId, IllegalDecisionError, mkEvent } from "@mtg-forge-ts/core";
import type { EngineYield } from "../action/engine-yield.js";
import type { Game } from "../game.js";

/**
 * Consumer-supplied shortcut result. `description` is a human-readable
 * summary written into the event payload; `loopCount` is the number of
 * iterations the loop was observed to run; `affected` is the set of
 * EntityIds whose state the loop mutates (surfaced on the event so log
 * subscribers can scope their UI updates); `finalState` is an opaque
 * payload reserved for SP5's apply-path.
 */
export interface LoopShortcutResult {
  readonly description: string;
  readonly loopCount: number;
  readonly affected: readonly EntityId[];
  // SP5 reserves the final-state shape. SP2 doesn't consume it; we hold
  // an opaque slot so callers can pre-populate the shortcut descriptor
  // without a schema migration later.
  readonly finalState?: unknown;
}

/**
 * Validate a shortcut descriptor. Valid shortcuts have:
 *  - a non-empty string `description`.
 *  - a non-negative integer `loopCount` (0 is allowed — "short-circuit
 *    before the first iteration"; useful for deterministic-skipping
 *    cases like empty combat assignments).
 */
const validateShortcut = (description: string, result: LoopShortcutResult): boolean => {
  if (typeof description !== "string" || description.length === 0) return false;
  if (!Number.isInteger(result.loopCount) || result.loopCount < 0) return false;
  return true;
};

export function* requestShortcut(
  game: Game,
  description: string,
  result: LoopShortcutResult,
): Generator<EngineYield, void, unknown> {
  if (!validateShortcut(description, result)) {
    throw new IllegalDecisionError(`requestShortcut: invalid shortcut descriptor (${description})`);
  }
  // SP2 stub — no state mutation. SP5 fills in the apply-path using
  // `result.finalState`. The event still fires so subscribers (replay,
  // decision log) record the shortcut request for deterministic replay.
  yield game.emitEvent(
    mkEvent("ShortcutApplied", game.turn, game.phase, {
      description,
      affected: result.affected,
    }),
  );
}
