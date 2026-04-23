// SPDX-License-Identifier: GPL-3.0-or-later
// Stack — ordered collection of StackItems (not EntityIds). Although
// ZoneType.Stack exists in the core enum so scripts / targeting AST can
// reference "the stack" as a zone per CR 400.1, the runtime representation
// diverges from Zone because items are rich records (with targets, modes,
// provenance) rather than card identifiers. Consequently Stack is NOT a Zone
// subclass and deliberately exposes a different API (push/pop/top/peek
// instead of add/remove/contains).
import type { EntityId } from "@mtg-forge-ts/core";
import { ZoneType } from "@mtg-forge-ts/core";
import type { StackItem } from "./stack-item.js";

export class Stack {
  private readonly items: StackItem[] = [];
  readonly type: ZoneType = ZoneType.Stack;

  push(item: StackItem): void {
    this.items.push(item);
  }

  pop(): StackItem | undefined {
    return this.items.pop();
  }

  top(): StackItem | undefined {
    return this.items[this.items.length - 1];
  }

  peek(i: number): StackItem | undefined {
    return this.items[i];
  }

  get size(): number {
    return this.items.length;
  }

  isEmpty(): boolean {
    return this.items.length === 0;
  }

  toArray(): StackItem[] {
    return [...this.items];
  }

  countItemsBySource(cardId: EntityId): number {
    return this.items.filter((it) => it.sourceCardId === cardId).length;
  }

  toJSON(): { items: StackItem[] } {
    return { items: [...this.items] };
  }
}
