// SPDX-License-Identifier: GPL-3.0-or-later
// CR 604 static effect registry. Mirrors TriggerRegistry/ReplacementRegistry
// surface: register/unregister by id; index by source card for bulk removal
// on zone-change (handled by zone-activation.ts).
//
// Subsystem split: THIS registry owns the id-indexed set. Layer contributors
// (Task 26), cost-mod contributors (Task 27), and replacement-generating
// contributors (Task 28) consume it by category.
//
// Milestone F fills this in incrementally:
//   Task 25 — id-indexed registry + zone-activation discipline
//   Task 26 — register/unregister also route continuous statics into
//             LayerEngine arrays
//   Task 27 — costMod + cantMustMay categories gathered via byCategory
//   Task 28 — register/unregister also route replacement-generating statics
//             through the replacement registry via ReplacementGenLedger
import type { EntityId, StaticAbility, StaticAbilityCategory } from "@mtg-forge-ts/core";
import type { Game } from "../game.js";
import { contributeToLayers, removeFromLayers } from "./layer-contributors.js";
import {
  ReplacementGenLedger,
  registerDerivedReplacements,
  unregisterDerivedReplacements,
} from "./replacement-generating.js";

export class StaticEffectRegistry {
  private readonly byId = new Map<EntityId, StaticAbility>();
  private readonly bySourceCard = new Map<EntityId, EntityId[]>();
  // Task 28 — side-index: static id → derived replacement ids. Populated
  // in register() for replacementGenerating statics; drained in
  // unregister(). Keeping the ledger private to the registry means the
  // bidirectional lifecycle is not observable from outside.
  private readonly replacementLedger = new ReplacementGenLedger();

  constructor(private readonly game: Game) {}

  register(s: StaticAbility): void {
    // Re-register of same id: unwind the previous instance so downstream
    // contributors see a clean pair of unregister+register, not an
    // accumulating leak. (Tasks 26/28 hook side-effects here.)
    const existing = this.byId.get(s.id);
    if (existing !== undefined) this.unregister(existing.id);
    this.byId.set(s.id, s);
    const list = this.bySourceCard.get(s.sourceCardId) ?? [];
    if (!list.includes(s.id)) list.push(s.id);
    this.bySourceCard.set(s.sourceCardId, list);
    // Task 26 — route continuous/abilityGranting statics into LayerEngine.
    // Category-gated inside contributeToLayers; a no-op for other kinds.
    contributeToLayers(this.game, s);
    // Task 28 — for replacementGenerating statics, register the derived
    // ReplacementAbility entries into ReplacementRegistry and remember
    // their ids via the ledger so unregister() can drop them later.
    registerDerivedReplacements(this.game, s, this.replacementLedger);
  }

  unregister(id: EntityId): void {
    const s = this.byId.get(id);
    if (!s) return;
    // Task 26 — unwind LayerEngine contribution BEFORE dropping the id-map
    // entry so the contributor helper can still rely on the static
    // reference (`s` is captured here).
    removeFromLayers(this.game, s);
    // Task 28 — drop any derived replacement-registry entries. Safe to
    // call unconditionally; the ledger is a no-op for non-replacement-
    // generating statics (no entry to pop).
    unregisterDerivedReplacements(this.game, s.id, this.replacementLedger);
    this.byId.delete(id);
    const list = this.bySourceCard.get(s.sourceCardId) ?? [];
    const next = list.filter((x) => x !== id);
    if (next.length === 0) this.bySourceCard.delete(s.sourceCardId);
    else this.bySourceCard.set(s.sourceCardId, next);
  }

  unregisterAllForCard(cardId: EntityId): void {
    const ids = this.bySourceCard.get(cardId) ?? [];
    // Snapshot the id list before iteration — unregister() mutates
    // bySourceCard, and iterating a mutating array is a foot-gun.
    for (const id of [...ids]) this.unregister(id);
  }

  all(): readonly StaticAbility[] {
    return [...this.byId.values()];
  }

  byCategory(c: StaticAbilityCategory): readonly StaticAbility[] {
    return [...this.byId.values()].filter((s) => s.category === c);
  }

  byCard(cardId: EntityId): readonly StaticAbility[] {
    const ids = this.bySourceCard.get(cardId) ?? [];
    return ids.map((id) => this.byId.get(id)).filter((s): s is StaticAbility => s !== undefined);
  }

  get(id: EntityId): StaticAbility | undefined {
    return this.byId.get(id);
  }

  size(): number {
    return this.byId.size;
  }

  // Game accessor — Tasks 26/28 extend register/unregister with layer
  // and replacement contributions that need game-level access.
  protected getGame(): Game {
    return this.game;
  }
}
