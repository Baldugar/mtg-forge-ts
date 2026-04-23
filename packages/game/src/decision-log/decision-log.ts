// SPDX-License-Identifier: GPL-3.0-or-later
// DecisionLog — append-only record of every (DecisionRequest, DecisionResponse)
// pair the engine produced during a game. Replay + undo depend on this log:
// given the same GameSnapshot starting point and the same sequence of logged
// responses, the engine's PhaseHandler reproduces the exact same game state
// (determinism contract, master-spec §11).
//
// DecisionIds are allocated in ascending order (0, 1, 2, …). They are *not*
// stable across games (a save restored mid-game resets the log alongside the
// snapshot) — they're identifiers within the log, not globally.
import type { DecisionId, DecisionRequest, DecisionResponse } from "@mtg-forge-ts/core";
import { mkDecisionId } from "@mtg-forge-ts/core";

/**
 * Recorded pair of request + response keyed by monotonically-ascending id.
 * Readonly everywhere: records are immutable once appended to preserve the
 * replay invariant (rewriting a past response would diverge the stream).
 */
export interface DecisionRecord {
  readonly id: DecisionId;
  readonly request: DecisionRequest;
  readonly response: DecisionResponse;
}

export class DecisionLog {
  private readonly records: DecisionRecord[] = [];
  private nextId = 0;

  /**
   * Append a (request, response) pair. Returns the allocated DecisionId so
   * callers can correlate entries with event logs / UI receipts.
   */
  append(request: DecisionRequest, response: DecisionResponse): DecisionId {
    const id = mkDecisionId(this.nextId++);
    this.records.push({ id, request, response });
    return id;
  }

  /** Number of recorded decisions. */
  size(): number {
    return this.records.length;
  }

  /**
   * Lookup by DecisionId. Because ids are 0..size-1 dense, this is an O(1)
   * array index under the hood (DecisionId brand is structurally number).
   */
  get(id: DecisionId): DecisionRecord | undefined {
    return this.records[id as unknown as number];
  }

  /**
   * Independent copy of the records — consumers can't mutate the live log by
   * pushing onto the returned array.
   */
  toArray(): DecisionRecord[] {
    return [...this.records];
  }

  /**
   * JSON-stringifiable view. DecisionRecord is already a plain-data shape so
   * this is a structural copy rather than a transform.
   */
  toJSON(): DecisionRecord[] {
    return this.records.map((r) => ({ id: r.id, request: r.request, response: r.response }));
  }

  /**
   * Reset the log. Snapshot-restore calls this before pushing the restored
   * replay state back in; tests also use it to reuse a fixture log. After
   * clear(), the next append() starts allocating ids at 0 again.
   */
  clear(): void {
    this.records.length = 0;
    this.nextId = 0;
  }
}
