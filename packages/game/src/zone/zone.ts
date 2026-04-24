// SPDX-License-Identifier: GPL-3.0-or-later
// Engine-side Zone base class. Holds an ordered list of EntityIds (card IDs)
// and provides mutation primitives used by move-effects, draw/discard, etc.
//
// Ordering convention (matches Forge/Java `CardCollection`):
//   index 0            = TOP of the zone (next card to draw / mill / reveal).
//   items.length - 1   = BOTTOM of the zone.
// This applies uniformly to Library (top-of-deck), Graveyard (top of pile),
// Stack-like orderings, etc. `Zone.add` defaults to appending at the bottom
// (index = items.length), which matches initial-deck-seeding semantics where
// the caller iterates the shuffled deck top-to-bottom and pushes each card.
// Use `addToTop` when an effect explicitly places a card on top of the zone.
//
// Note: Stack is NOT a Zone subclass — it holds StackItem objects (not
// EntityIds) and is defined separately in Task 37.
import type { EntityId, PlayerSeat, ZoneType } from "@mtg-forge-ts/core";

export abstract class Zone {
  protected readonly items: EntityId[] = [];

  constructor(
    readonly type: ZoneType,
    readonly ownerSeat: PlayerSeat | null,
  ) {}

  get size(): number {
    return this.items.length;
  }

  add(cardId: EntityId, index: number = this.items.length): void {
    if (index < 0 || index > this.items.length) {
      throw new RangeError(`Zone.add: index ${index} out of range [0, ${this.items.length}]`);
    }
    this.items.splice(index, 0, cardId);
  }

  // WHY: convenience wrapper for "place on top" semantics. Keeping the raw
  // `add(id, 0)` path available avoids breaking existing call sites that
  // already pass an explicit index; this helper gives effects like "put this
  // card on top of its owner's library" a self-documenting call.
  addToTop(cardId: EntityId): void {
    this.items.splice(0, 0, cardId);
  }

  remove(cardId: EntityId): boolean {
    const i = this.items.indexOf(cardId);
    if (i < 0) return false;
    this.items.splice(i, 1);
    return true;
  }

  // WHY: callers that consume top-of-zone (draw, mill, scry) avoid a
  // redundant `indexOf` scan by removing by index directly. Returns the
  // removed id or undefined when the zone was empty.
  removeAt(index: number): EntityId | undefined {
    if (index < 0 || index >= this.items.length) return undefined;
    const [removed] = this.items.splice(index, 1);
    return removed;
  }

  // WHY: GameAction.drawCards / mill need to know the card id BEFORE the
  // draw/mill intent is routed through replacements (so the canonical
  // CardDrawn/CardMilled event payload can reference it) without mutating
  // the zone. Returns undefined for an out-of-range index — mirrors
  // removeAt's defensive empty-zone shape.
  peekAt(index: number): EntityId | undefined {
    if (index < 0 || index >= this.items.length) return undefined;
    return this.items[index];
  }

  contains(cardId: EntityId): boolean {
    return this.items.includes(cardId);
  }

  indexOf(cardId: EntityId): number {
    return this.items.indexOf(cardId);
  }

  toArray(): EntityId[] {
    return [...this.items];
  }

  clear(): void {
    this.items.length = 0;
  }

  toJSON(): { type: ZoneType; ownerSeat: PlayerSeat | null; items: EntityId[] } {
    return { type: this.type, ownerSeat: this.ownerSeat, items: [...this.items] };
  }
}
