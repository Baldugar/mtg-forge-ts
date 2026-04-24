// SPDX-License-Identifier: GPL-3.0-or-later
// CR 614 replacement registry. Stores every active ReplacementAbility;
// GameAction consults gatherApplicable(intent, excluded) before applying a
// mutation. CR 616 ordering + ETB self-replacement precedence + one-apply
// rule are Tasks 17 and 18.
//
// Tasks 25-28 (Milestone F — statics) populate this registry automatically
// from replacement-generating static abilities. SP2 also supports direct
// register() for effects that create replacements dynamically.
import type { EntityId, MutationIntent, ReplacementAbility } from "@mtg-forge-ts/core";

export class ReplacementRegistry {
  private readonly byId = new Map<EntityId, ReplacementAbility>();
  private readonly bySourceCard = new Map<EntityId, EntityId[]>();

  register(r: ReplacementAbility): void {
    this.byId.set(r.id, r);
    const list = this.bySourceCard.get(r.sourceCardId) ?? [];
    list.push(r.id);
    this.bySourceCard.set(r.sourceCardId, list);
  }

  unregister(id: EntityId): void {
    const r = this.byId.get(id);
    if (!r) return;
    this.byId.delete(id);
    const list = this.bySourceCard.get(r.sourceCardId) ?? [];
    const filtered = list.filter((x) => x !== id);
    if (filtered.length === 0) {
      this.bySourceCard.delete(r.sourceCardId);
    } else {
      this.bySourceCard.set(r.sourceCardId, filtered);
    }
  }

  unregisterAllForCard(cardId: EntityId): void {
    const ids = this.bySourceCard.get(cardId) ?? [];
    for (const id of ids) this.byId.delete(id);
    this.bySourceCard.delete(cardId);
  }

  gatherApplicable(intent: MutationIntent, excluded: ReadonlySet<EntityId>): readonly ReplacementAbility[] {
    return [...this.byId.values()].filter((r) => !excluded.has(r.id) && r.matches(intent));
  }

  all(): readonly ReplacementAbility[] {
    return [...this.byId.values()];
  }

  byCard(cardId: EntityId): readonly ReplacementAbility[] {
    const ids = this.bySourceCard.get(cardId) ?? [];
    return ids.map((id) => this.byId.get(id)).filter((r): r is ReplacementAbility => r !== undefined);
  }

  size(): number {
    return this.byId.size;
  }
}
