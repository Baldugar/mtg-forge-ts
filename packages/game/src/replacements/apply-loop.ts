// SPDX-License-Identifier: GPL-3.0-or-later
// CR 614.1c-d + 614.5 — the replacement apply loop.
//
// Gather applicable (excluding already-applied), partition self-first for
// ETB permanent-entering intents, order via CR 616, apply in order, add
// each id to the applied set, re-gather. Continue until:
//   - No more applicable replacements (return the mutated intent).
//   - A replacement returns null (prevention: return null and let caller
//     emit EventPrevented).
//
// Used by Task 19's GameAction.applyWithReplacements.
import type { EntityId, MutationIntent, ReplacementAbility } from "@mtg-forge-ts/core";
import { ZoneType } from "@mtg-forge-ts/core";
import type { EngineYield } from "../action/engine-yield.js";
import type { Game } from "../game.js";
import { orderReplacements } from "./replacement-orderer.js";

/**
 * CR 614.1c-d: "permanent entering the battlefield" event — the only
 * class that gets self-replacement precedence. We detect it as a
 * moveTo intent whose target zone is Battlefield.
 */
const isPermanentEntering = (intent: MutationIntent): boolean => {
  if (intent.kind !== "moveTo") return false;
  const toZone = (intent as { toZone?: unknown }).toZone;
  return toZone === ZoneType.Battlefield;
};

/**
 * A replacement is "self-replacement for intent I" when its source card
 * is the same card the intent operates on — e.g. "[this permanent] enters
 * the battlefield with N +1/+1 counters on it" is a self-replacement for
 * its own moveTo-to-battlefield intent.
 */
const sameSource = (r: ReplacementAbility, intent: MutationIntent): boolean => {
  const cid = (intent as { cardId?: unknown }).cardId;
  return typeof cid === "number" && (cid as EntityId) === r.sourceCardId;
};

export type ApplyResult =
  | { readonly status: "applied"; readonly final: MutationIntent; readonly appliedIds: readonly EntityId[] }
  | {
      readonly status: "prevented";
      readonly original: MutationIntent;
      readonly appliedIds: readonly EntityId[];
    };

/**
 * Replacement apply loop. See file header.
 *
 * CR 614.5 — "each replacement effect can apply at most once to any one
 * event" — is realised by the `applied` set joined on every apply; the
 * re-gather step filters it out via the registry's `excluded` argument.
 */
export function* applyReplacementLoop(
  initial: MutationIntent,
  game: Game,
): Generator<EngineYield, ApplyResult, unknown> {
  let current = initial;
  const applied = new Set<EntityId>();
  const appliedOrdered: EntityId[] = [];

  while (true) {
    const all = game.replacementRegistry.gatherApplicable(current, applied);
    if (all.length === 0) {
      return { status: "applied", final: current, appliedIds: appliedOrdered };
    }

    // CR 614.1c-d — for permanent-enter intents, partition self-replacements
    // from external and apply self-first. For non-ETB intents everything is
    // a single mixed batch (no self-precedence).
    const isEtb = isPermanentEntering(current);
    let batch: readonly ReplacementAbility[];
    if (isEtb) {
      const self = all.filter((r) => sameSource(r, current));
      const external = all.filter((r) => !sameSource(r, current));
      batch = self.length > 0 ? self : external;
    } else {
      batch = all;
    }

    // Defensive: if partitioning somehow yielded no work, stop.
    if (batch.length === 0) {
      return { status: "applied", final: current, appliedIds: appliedOrdered };
    }

    // CR 616 ordering for this batch.
    const order = yield* orderReplacements(batch, current, game);

    // Apply in order. Each id joins `applied` (CR 614.5 one-apply rule).
    // A replacement returning null is a prevention — exit immediately.
    for (const rid of order) {
      const r = batch.find((x) => x.id === rid);
      if (!r) continue;
      const next = r.apply(current, game) as MutationIntent | null;
      applied.add(rid);
      appliedOrdered.push(rid);
      if (next === null) {
        return { status: "prevented", original: current, appliedIds: appliedOrdered };
      }
      current = next;
    }
    // Loop: re-gather applicable. Replacements already applied stay
    // excluded; replacements that became applicable mid-loop (because a
    // prior apply mutated `current`) get picked up on the next pass.
  }
}
