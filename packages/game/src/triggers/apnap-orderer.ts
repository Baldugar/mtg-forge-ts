// SPDX-License-Identifier: GPL-3.0-or-later
// CR 603.3b — APNAP ordering for simultaneously-fired triggers.
//
// Active Player first, then each Non-Active Player in turn order. Within
// each player's group, that player orders their triggers (yield an
// `orderTriggers` decision if group size > 1). Final stack order: the
// first trigger in the combined (APNAP-flat) order lands on TOP of the
// stack (pushed last), so callers iterate the returned array and push in
// order.
//
// Return contract: triggers in stack-push order. That is the reverse of
// the APNAP-flat order, so that pushing them in-order results in the
// "first triggered in combined order" sitting atop the LIFO stack.
import type { EntityId, PlayerSeat } from "@mtg-forge-ts/core";
import type { EngineYield } from "../action/engine-yield.js";
import type { PendingTrigger } from "./pending-trigger.js";

const groupByController = (pending: readonly PendingTrigger[]): Map<PlayerSeat, PendingTrigger[]> => {
  const groups = new Map<PlayerSeat, PendingTrigger[]>();
  for (const p of pending) {
    const list = groups.get(p.sourceControllerAtFire) ?? [];
    list.push(p);
    groups.set(p.sourceControllerAtFire, list);
  }
  return groups;
};

const rotatedFromActive = (seats: readonly PlayerSeat[], active: PlayerSeat): readonly PlayerSeat[] => {
  const idx = seats.indexOf(active);
  if (idx < 0) return seats;
  return [...seats.slice(idx), ...seats.slice(0, idx)];
};

/**
 * Orchestrate the APNAP ordering pass over a collection of simultaneously
 * fired triggers. Yields `orderTriggers` decisions for any player who has
 * >1 trigger to order; returns the full stack-push-ordered list of
 * triggers when done.
 *
 * The response shape is `{ order: readonly EntityId[] }` — the PendingTrigger
 * ids (not the underlying triggerIds), since a single TriggeredAbility
 * can queue multiple pending entries and each ordering decision is about
 * those concrete instances.
 */
export function* apnapOrder(
  pending: readonly PendingTrigger[],
  activeSeat: PlayerSeat,
  seats: readonly PlayerSeat[],
): Generator<EngineYield, readonly PendingTrigger[], unknown> {
  if (pending.length === 0) return [];
  const groups = groupByController(pending);
  const turnOrder = rotatedFromActive(seats, activeSeat);
  const flat: PendingTrigger[] = [];
  for (const seat of turnOrder) {
    const group = groups.get(seat) ?? [];
    if (group.length === 0) continue;
    if (group.length === 1) {
      const only = group[0];
      if (only) flat.push(only);
      continue;
    }
    const response = (yield {
      kind: "decision",
      request: {
        kind: "orderTriggers",
        playerSeat: seat,
        triggerIds: group.map((g) => g.id),
      },
    }) as { readonly order: readonly EntityId[] } | undefined;
    if (!response || !Array.isArray(response.order) || response.order.length !== group.length) {
      throw new Error(
        `apnapOrder: invalid response ${JSON.stringify(response)} — must be a permutation of ${JSON.stringify(
          group.map((g) => g.id),
        )}`,
      );
    }
    const seen = new Set<EntityId>();
    for (const id of response.order) {
      const t = group.find((g) => g.id === id);
      if (!t) throw new Error(`apnapOrder: response includes unknown id ${id}`);
      if (seen.has(id)) throw new Error(`apnapOrder: duplicate id ${id} in response`);
      seen.add(id);
      flat.push(t);
    }
  }
  // Stack is LIFO — reverse so pushing in returned order lands "first
  // triggered in combined order" on top (pushed last).
  return [...flat].reverse();
}
