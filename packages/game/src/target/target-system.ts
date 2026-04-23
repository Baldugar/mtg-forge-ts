// SPDX-License-Identifier: GPL-3.0-or-later
// TargetSystem — SP1 scaffold. SP2 replaces both methods with real CR 601/608
// targeting: legality at cast (validateAtCast) vs. legality on resolution
// after intervening state changes (validateAtResolve, returning the legal /
// illegal partition so the stack item can fizzle or recompute effects).
import type { EntityId } from "@mtg-forge-ts/core";

export interface TargetChoices {
  readonly targets: readonly EntityId[];
  // For "divide X damage" spells — target index -> amount. Keys are numeric
  // strings because TS Record with number keys still emits as strings at
  // runtime; consumers index by number but the storage key is coerced.
  readonly divisions?: Readonly<Record<number, number>>;
}

export class TargetSystem {
  validateAtCast(_choices: TargetChoices, _sourceId: EntityId): boolean {
    throw new Error("TargetSystem.validateAtCast: SP2 target system required");
  }

  validateAtResolve(
    _choices: TargetChoices,
    _sourceId: EntityId,
  ): { legal: readonly EntityId[]; illegal: readonly EntityId[] } {
    throw new Error("TargetSystem.validateAtResolve: SP2 target system required");
  }
}
