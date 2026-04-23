// SPDX-License-Identifier: GPL-3.0-or-later
import { mkPlayerSeat } from "@mtg-forge-ts/core";
import { describe, expect, it } from "vitest";
import { type Turn, TurnQueue } from "./turn-queue.js";

const turn = (seat: number, isExtra = false): Turn => ({
  activePlayer: mkPlayerSeat(seat),
  isExtra,
});

describe("TurnQueue", () => {
  it("empty queue: pop undefined, length 0, peekNext undefined", () => {
    const q = new TurnQueue();
    expect(q.length).toBe(0);
    expect(q.pop()).toBeUndefined();
    expect(q.peekNext()).toBeUndefined();
  });

  it("push 3 turns, pop in FIFO order", () => {
    const q = new TurnQueue();
    const t0 = turn(0);
    const t1 = turn(1);
    const t2 = turn(0);
    q.push(t0);
    q.push(t1);
    q.push(t2);
    expect(q.length).toBe(3);
    expect(q.pop()).toBe(t0);
    expect(q.pop()).toBe(t1);
    expect(q.pop()).toBe(t2);
    expect(q.pop()).toBeUndefined();
  });

  it("pushExtra places the turn at the FRONT (fires before queued turns)", () => {
    const q = new TurnQueue();
    const normal = turn(1);
    const extra = turn(0, true);
    q.push(normal);
    q.pushExtra(extra);
    expect(q.pop()).toBe(extra);
    expect(q.pop()).toBe(normal);
  });

  it("injectSkip adds a skip marker (isSkip=true) at the front", () => {
    const q = new TurnQueue();
    const normal = turn(0);
    q.push(normal);
    q.injectSkip(1);
    expect(q.length).toBe(2);
    const first = q.pop();
    expect(first?.isSkip).toBe(true);
    expect(q.pop()).toBe(normal);
  });

  it("injectSkip with count=3 prepends three skip markers", () => {
    const q = new TurnQueue();
    q.push(turn(0));
    q.injectSkip(3);
    expect(q.length).toBe(4);
    expect(q.pop()?.isSkip).toBe(true);
    expect(q.pop()?.isSkip).toBe(true);
    expect(q.pop()?.isSkip).toBe(true);
    expect(q.pop()?.isSkip).toBeUndefined();
  });

  it("peekNext returns the next turn without removing it", () => {
    const q = new TurnQueue();
    const t = turn(0);
    q.push(t);
    expect(q.peekNext()).toBe(t);
    expect(q.length).toBe(1);
    expect(q.pop()).toBe(t);
    expect(q.peekNext()).toBeUndefined();
  });

  it("toArray returns a snapshot copy (mutations don't leak)", () => {
    const q = new TurnQueue();
    q.push(turn(0));
    q.push(turn(1));
    const arr = q.toArray();
    expect(arr).toHaveLength(2);
    arr.length = 0;
    expect(q.length).toBe(2);
  });
});
