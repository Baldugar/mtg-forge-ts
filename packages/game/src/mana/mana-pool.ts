// SPDX-License-Identifier: GPL-3.0-or-later
// Per-player mana pool: an ordered list of ManaProduced atoms waiting to be
// spent. SP1 scope is the pool container (add/empty/snapshot/restore/etc.);
// payment logic (canPay, removeForPayment) requires SP3's cost-system
// implementation and therefore throws here. Snapshot/restore make it cheap
// for GameSnapshot and the driver loop to roll back tentative mana
// production during cost-payment exploration.
import type { Cost, ManaProduced } from "@mtg-forge-ts/core";

export class ManaPool {
  private shards: ManaProduced[] = [];

  add(s: ManaProduced): void {
    this.shards.push(s);
  }

  empty(): void {
    this.shards.length = 0;
  }

  snapshot(): ManaProduced[] {
    return [...this.shards];
  }

  restore(snap: readonly ManaProduced[]): void {
    this.shards = [...snap];
  }

  size(): number {
    return this.shards.length;
  }

  toArray(): ManaProduced[] {
    return [...this.shards];
  }

  toJSON(): { shards: ReturnType<ManaProduced["toJSON"]>[] } {
    return { shards: this.shards.map((s) => s.toJSON()) };
  }

  // WHY: typed signature kept stable so SP1 callers can reference the method,
  // but real cost-vs-pool matching depends on SP3's Cost AST and Forge's
  // ManaCostShard semantics; implementing it here would lock the engine to an
  // incomplete model.
  canPay(_cost: Cost): boolean {
    throw new Error("ManaPool.canPay: SP3 cost system required");
  }

  removeForPayment(_cost: Cost): void {
    throw new Error("ManaPool.removeForPayment: SP3 cost system required");
  }
}
