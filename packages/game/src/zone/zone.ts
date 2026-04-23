// SPDX-License-Identifier: GPL-3.0-or-later
// Engine-side Zone base class. Holds an ordered list of EntityIds (card IDs)
// and provides mutation primitives used by move-effects, draw/discard, etc.
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

  remove(cardId: EntityId): boolean {
    const i = this.items.indexOf(cardId);
    if (i < 0) return false;
    this.items.splice(i, 1);
    return true;
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
