// SPDX-License-Identifier: GPL-3.0-or-later
// TurnQueue — ordered schedule of upcoming turns driven by PhaseHandler.run.
// Normal turns are appended at the back (FIFO). Extra-turn effects (Time
// Walk, Temporal Manipulation) push a single Turn with isExtra=true at the
// FRONT so it fires before the next player's scheduled turn. Skip-turn
// effects (Time Stop, etc.) inject "skip markers" at the front, which the
// handler pops and discards without emitting turn-scoped events.
//
// Note: the original plan template suggested mkPlayerSeat(-1) as a skip
// sentinel, but mkPlayerSeat validates seat ≥ 0 and would throw. We instead
// carry an explicit `isSkip` flag on the Turn interface; the activePlayer
// field is irrelevant for a skip-marker and conventionally set to seat 0.
import { type PlayerSeat, mkPlayerSeat } from "@mtg-forge-ts/core";

export interface Turn {
  readonly activePlayer: PlayerSeat;
  readonly isExtra: boolean;
  readonly isSkip?: boolean;
}

export class TurnQueue {
  private readonly q: Turn[] = [];

  push(t: Turn): void {
    this.q.push(t);
  }

  // Extra turns fire BEFORE the next scheduled turn — push to front.
  pushExtra(t: Turn): void {
    this.q.unshift(t);
  }

  pop(): Turn | undefined {
    return this.q.shift();
  }

  // Insert N skip markers at the front. The activePlayer field on a skip
  // marker is unused by the handler but must satisfy mkPlayerSeat's non-
  // negative validator; seat 0 is a safe placeholder.
  injectSkip(count = 1): void {
    for (let i = 0; i < count; i++) {
      this.q.unshift({ activePlayer: mkPlayerSeat(0), isExtra: false, isSkip: true });
    }
  }

  peekNext(): Turn | undefined {
    return this.q[0];
  }

  get length(): number {
    return this.q.length;
  }

  toArray(): Turn[] {
    return [...this.q];
  }
}
