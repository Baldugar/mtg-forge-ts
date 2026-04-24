// SPDX-License-Identifier: GPL-3.0-or-later
// Replacement-generating statics — e.g., "auras you control have 'when this
// leaves, draw a card'" (Auratog-style). When the static activates, it
// derives one or more ReplacementAbility instances and registers them
// into the game's ReplacementRegistry. On deactivation, they're removed.
//
// The static's describe() returns { kind: "replacementGen", replacements:
// readonly ReplacementAbility[] }. Each replacement carries its own id;
// the static tracks those ids so unregister can find them.
//
// Ledger: StaticEffectRegistry holds a ReplacementGenLedger side-index
// keyed by static id so unregister can find and drop the derived
// replacements without re-invoking describe() (which might not be
// referentially stable across calls).
import type { EntityId, ReplacementAbility, StaticAbility } from "@mtg-forge-ts/core";
import type { Game } from "../game.js";

export interface ReplacementGenPayload {
  readonly kind: "replacementGen";
  readonly replacements: readonly ReplacementAbility[];
}

export class ReplacementGenLedger {
  private readonly byStaticId = new Map<EntityId, readonly EntityId[]>();

  set(staticId: EntityId, replacementIds: readonly EntityId[]): void {
    this.byStaticId.set(staticId, [...replacementIds]);
  }

  pop(staticId: EntityId): readonly EntityId[] {
    const ids = this.byStaticId.get(staticId) ?? [];
    this.byStaticId.delete(staticId);
    return ids;
  }

  has(staticId: EntityId): boolean {
    return this.byStaticId.has(staticId);
  }

  size(): number {
    return this.byStaticId.size;
  }
}

export const registerDerivedReplacements = (
  game: Game,
  s: StaticAbility,
  ledger: ReplacementGenLedger,
): void => {
  if (s.category !== "replacementGenerating") return;
  const payload = s.describe() as ReplacementGenPayload;
  const ids: EntityId[] = [];
  for (const r of payload.replacements) {
    game.replacementRegistry.register(r);
    ids.push(r.id);
  }
  ledger.set(s.id, ids);
};

export const unregisterDerivedReplacements = (
  game: Game,
  staticId: EntityId,
  ledger: ReplacementGenLedger,
): void => {
  const ids = ledger.pop(staticId);
  for (const id of ids) game.replacementRegistry.unregister(id);
};
