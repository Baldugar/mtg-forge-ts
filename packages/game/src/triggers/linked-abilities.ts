// SPDX-License-Identifier: GPL-3.0-or-later
// CR 607 linked abilities.
//
// When ability A exiles card X and ability B on the same permanent
// references "the exiled card", B reads from this table keyed by A's
// ability-instance id (NOT the source card, because the same card may
// have multiple instances of the linked pair live simultaneously — e.g.,
// two cards with flicker-type abilities activated on the same turn).
//
// Lookup contract:
//   - set(instanceId, linkedIds): A's resolution records the cards it
//     sent to exile (or otherwise "tagged").
//   - get(instanceId): B's resolution reads the ids. Returns an empty
//     readonly array when nothing was recorded — distinct from a
//     "never set" case only via has().
//   - has(instanceId): distinguishes "set with empty list" from "never
//     set" for linked-pair bookkeeping.
//   - clear(instanceId): called when the linked pair goes out of scope
//     (usually when the permanent leaves the battlefield or the exiled
//     cards are no longer exiled).
//
// Stored arrays are copied on set() so callers can mutate their inputs
// without affecting the table. Stored values are returned directly from
// get() (as readonly) — consumers must not mutate.
import type { EntityId } from "@mtg-forge-ts/core";

export class LinkedAbilityTable {
  private readonly table = new Map<EntityId, readonly EntityId[]>();

  set(instanceId: EntityId, linkedCardIds: readonly EntityId[]): void {
    this.table.set(instanceId, [...linkedCardIds]);
  }

  get(instanceId: EntityId): readonly EntityId[] {
    return this.table.get(instanceId) ?? [];
  }

  has(instanceId: EntityId): boolean {
    return this.table.has(instanceId);
  }

  clear(instanceId: EntityId): void {
    this.table.delete(instanceId);
  }

  size(): number {
    return this.table.size;
  }
}
