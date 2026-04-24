// SPDX-License-Identifier: GPL-3.0-or-later
// SP2 Task 64 — extra-turn + skip-turn primitive semantics. The base
// primitives (pushExtra/injectSkip) landed in SP1. Task 64 validates the
// full ordering contract:
//   - Multiple pushExtra calls fire LIFO (last-pushed fires first).
//   - injectSkip interleaved with pushExtra preserves the "injected at
//     front" invariant.
//   - Skip markers can be inspected via toArray for driver logging.
import { mkPlayerSeat } from "@mtg-forge-ts/core";
import { describe, expect, it } from "vitest";
import { type Turn, TurnQueue } from "./turn-queue.js";

const turn = (seat: number, isExtra = false): Turn => ({
  activePlayer: mkPlayerSeat(seat),
  isExtra,
});

describe("TurnQueue extra-turn ordering (SP2 Task 64)", () => {
  it("multiple pushExtra in sequence fire LIFO — last-pushed fires first", () => {
    // Scenario: during Player 0's turn, Player 0 casts two successive
    // extra-turn spells (Time Walk + Temporal Manipulation). CR 500.7 says
    // the LAST extra-turn effect created fires first. Our LIFO unshift
    // satisfies this: pushExtra(T1) makes [T1], pushExtra(T2) makes
    // [T2, T1], and pop() yields T2 first.
    const q = new TurnQueue();
    q.push(turn(1));
    const extra1 = turn(0, true);
    const extra2 = turn(0, true);
    q.pushExtra(extra1);
    q.pushExtra(extra2);
    expect(q.pop()).toBe(extra2);
    expect(q.pop()).toBe(extra1);
    expect(q.pop()?.activePlayer).toBe(mkPlayerSeat(1));
  });

  it("pushExtra then injectSkip: skip fires first, then extra (skip is most-recently-inserted)", () => {
    // CR 500.7 + CR 500.8 — "skip your next turn" and "take an extra turn"
    // compete; the most-recently-inserted marker fires first. pushExtra
    // adds at front, then injectSkip pushes AHEAD of that — so skip first,
    // then extra, then the normal turn.
    const q = new TurnQueue();
    const normal = turn(1);
    const extra = turn(0, true);
    q.push(normal);
    q.pushExtra(extra);
    q.injectSkip(1);
    const a = q.pop();
    const b = q.pop();
    const c = q.pop();
    expect(a?.isSkip).toBe(true);
    expect(b).toBe(extra);
    expect(c).toBe(normal);
  });

  it("injectSkip then pushExtra: extra fires first (most-recently-inserted)", () => {
    const q = new TurnQueue();
    q.push(turn(1));
    q.injectSkip(1);
    const extra = turn(0, true);
    q.pushExtra(extra);
    expect(q.pop()).toBe(extra);
    expect(q.pop()?.isSkip).toBe(true);
    expect(q.pop()?.activePlayer).toBe(mkPlayerSeat(1));
  });

  it("injectSkip default count is 1", () => {
    const q = new TurnQueue();
    q.push(turn(0));
    q.injectSkip();
    expect(q.length).toBe(2);
    expect(q.pop()?.isSkip).toBe(true);
  });

  it("injectSkip count=0 is a no-op", () => {
    const q = new TurnQueue();
    q.push(turn(0));
    q.injectSkip(0);
    expect(q.length).toBe(1);
    expect(q.pop()?.isSkip).toBeUndefined();
  });

  it("skip markers don't carry an isExtra flag", () => {
    const q = new TurnQueue();
    q.injectSkip(1);
    const s = q.pop();
    expect(s?.isSkip).toBe(true);
    expect(s?.isExtra).toBe(false);
  });

  it("interleaved extras across turns preserve LIFO within each insertion batch", () => {
    // Simulate: P0 turn inserts extras A, B; P1's turn inserts extras C,
    // D. Expected pop order immediately after P1's turn: D, C, then B, A
    // (each batch pops LIFO, and batch order is insertion order).
    // Since each pushExtra unshifts to front, the effective stack at end
    // of second insertion is [D, C, B, A] — LIFO.
    const q = new TurnQueue();
    const a = turn(0, true);
    const b = turn(0, true);
    const c = turn(1, true);
    const d = turn(1, true);
    q.pushExtra(a);
    q.pushExtra(b);
    q.pushExtra(c);
    q.pushExtra(d);
    expect(q.pop()).toBe(d);
    expect(q.pop()).toBe(c);
    expect(q.pop()).toBe(b);
    expect(q.pop()).toBe(a);
  });
});
