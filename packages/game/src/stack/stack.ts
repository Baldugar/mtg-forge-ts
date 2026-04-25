// SPDX-License-Identifier: GPL-3.0-or-later
// Stack — ordered collection of StackItems (not EntityIds). Although
// ZoneType.Stack exists in the core enum so scripts / targeting AST can
// reference "the stack" as a zone per CR 400.1, the runtime representation
// diverges from Zone because items are rich records (with targets, modes,
// provenance) rather than card identifiers. Consequently Stack is NOT a Zone
// subclass and deliberately exposes a different API (push/pop/top/peek
// instead of add/remove/contains).
//
// CR 707.10 — stack-copy mechanics. `copy()` creates an independent StackItem
// sharing the source's modes/targets/X with a new EntityId, a (possibly) new
// controller, `kind: "copy"`, and `isCast: false` (so cast-triggers do NOT
// fire for copies). Resolution semantics live in Task 67: when a copy item
// resolves, the effect body runs but no zone-change happens (the copy has no
// real source card to move), and no cast triggers fire. Callers pass the
// Game reference here (rather than the Stack holding one) to avoid a
// construction-time cycle — Stack is built in Game's ctor before Game is
// fully live. Task 55/56 callers (CastPipeline extensions, future resolution
// driver) already hold `game`; threading it through this one call site is
// cheaper than wiring a setter or factory.
import type { EntityId, PlayerSeat } from "@mtg-forge-ts/core";
import { GameStateIntegrityError, ZoneType } from "@mtg-forge-ts/core";
import type { Game } from "../game.js";
import type { StackItem } from "./stack-item.js";

/**
 * CR 707.10 — options passed to Stack.copy. For now the only slot is
 * `changeTargets`, which (when present) replaces the copy's target choices
 * with a caller-provided value. The target shape is SP2 Task 40's
 * TargetChoices; StackItem still carries it as `unknown`, so we mirror that.
 */
export interface StackCopyOptions {
  readonly changeTargets?: unknown;
}

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

  /**
   * CR 701.5 — remove a specific stack item by id (counter/fizzle). Returns
   * the removed item, or undefined if the item is not currently on the stack.
   * Unlike pop() this removes from an arbitrary position, preserving the
   * LIFO order of remaining items.
   */
  removeById(id: EntityId): StackItem | undefined {
    const i = this.items.findIndex((it) => it.id === id);
    if (i < 0) return undefined;
    const [removed] = this.items.splice(i, 1);
    return removed;
  }

  /**
   * CR 707.10 — create a copy of an existing stack item and push it onto
   * the stack. The copy inherits the source's `sourceCardId`, `modes`,
   * `targets`, `xValue`, `costPaid`, and `provenance` but gets a fresh
   * `EntityId`, a caller-chosen `controllerSeat`, `kind: "copy"`, and
   * `isCast: false`. Optionally the caller can pass `changeTargets` to
   * retarget the copy (e.g. "Twinflame" new-controller retarget).
   *
   * Throws GameStateIntegrityError if `sourceItemId` is not currently on
   * this Stack — copies of already-resolved items are not supported here
   * (they're modeled as LKI-fueled delayed triggers, not stack items).
   */
  copy(
    sourceItemId: EntityId,
    newController: PlayerSeat,
    game: Game,
    options: StackCopyOptions = {},
  ): StackItem {
    const source = this.items.find((i) => i.id === sourceItemId);
    if (!source) {
      throw new GameStateIntegrityError(`Stack.copy: source ${sourceItemId} not on stack`);
    }
    const id = game.newEntityId();
    const copyItem: StackItem = {
      ...source,
      id,
      controllerSeat: newController,
      kind: "copy",
      isCast: false,
      // changeTargets === undefined → preserve source targets (spread wins).
      // changeTargets !== undefined → override (including explicit null to
      // drop targets). Use `in` semantics via the explicit check so that
      // passing `{ changeTargets: null }` actually drops the targets array.
      ...(options.changeTargets !== undefined ? { targets: options.changeTargets } : {}),
    };
    this.items.push(copyItem);
    return copyItem;
  }
}
