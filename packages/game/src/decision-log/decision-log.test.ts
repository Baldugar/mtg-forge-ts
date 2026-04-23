// SPDX-License-Identifier: GPL-3.0-or-later
import type { DecisionRequest, DecisionResponse, EntityId } from "@mtg-forge-ts/core";
import { mkDecisionId, mkEntityId, mkPlayerSeat } from "@mtg-forge-ts/core";
import { describe, expect, it } from "vitest";
import { DecisionLog } from "./decision-log.js";

const mulliganRequest = (seat: number): DecisionRequest => ({
  kind: "mulligan",
  playerSeat: mkPlayerSeat(seat),
  currentHand: [mkEntityId(1), mkEntityId(2), mkEntityId(3)] as readonly EntityId[],
  mulligansSoFar: 0,
  rule: "london",
});

const mulliganResponse = (keep: boolean): DecisionResponse => ({
  kind: "mulligan",
  keep,
});

const priorityRequest = (seat: number): DecisionRequest => ({
  kind: "priority",
  playerSeat: mkPlayerSeat(seat),
  legalActions: [{ kind: "pass" }],
});

const priorityResponse = (): DecisionResponse => ({
  kind: "priority",
  action: { kind: "pass" },
});

describe("DecisionLog", () => {
  it("is empty on construction", () => {
    const log = new DecisionLog();
    expect(log.size()).toBe(0);
    expect(log.toArray()).toEqual([]);
    expect(log.toJSON()).toEqual([]);
  });

  it("append allocates ascending DecisionIds starting at 0", () => {
    const log = new DecisionLog();
    const id0 = log.append(mulliganRequest(0), mulliganResponse(true));
    const id1 = log.append(priorityRequest(0), priorityResponse());
    const id2 = log.append(priorityRequest(1), priorityResponse());
    expect(id0).toBe(mkDecisionId(0));
    expect(id1).toBe(mkDecisionId(1));
    expect(id2).toBe(mkDecisionId(2));
    expect(log.size()).toBe(3);
  });

  it("get(id) returns the recorded request/response pair", () => {
    const log = new DecisionLog();
    const req = mulliganRequest(0);
    const resp = mulliganResponse(false);
    const id = log.append(req, resp);
    const record = log.get(id);
    expect(record).toBeDefined();
    expect(record?.id).toBe(id);
    expect(record?.request).toBe(req);
    expect(record?.response).toBe(resp);
  });

  it("get(id) returns undefined for out-of-range id", () => {
    const log = new DecisionLog();
    log.append(mulliganRequest(0), mulliganResponse(true));
    expect(log.get(mkDecisionId(99))).toBeUndefined();
  });

  it("toArray returns an independent copy (mutation does not affect the log)", () => {
    const log = new DecisionLog();
    log.append(mulliganRequest(0), mulliganResponse(true));
    const arr = log.toArray();
    arr.length = 0;
    expect(log.size()).toBe(1);
  });

  it("toJSON produces a JSON-stringifiable shape with all records", () => {
    const log = new DecisionLog();
    log.append(mulliganRequest(0), mulliganResponse(true));
    log.append(priorityRequest(0), priorityResponse());
    const json = log.toJSON();
    expect(json).toHaveLength(2);
    expect(json[0]?.id).toBe(mkDecisionId(0));
    expect(json[1]?.id).toBe(mkDecisionId(1));
    expect(() => JSON.stringify(json)).not.toThrow();
  });

  it("clear resets records and the id counter", () => {
    const log = new DecisionLog();
    log.append(mulliganRequest(0), mulliganResponse(true));
    log.append(priorityRequest(0), priorityResponse());
    expect(log.size()).toBe(2);
    log.clear();
    expect(log.size()).toBe(0);
    expect(log.toArray()).toEqual([]);
    // Next append starts at 0 again.
    const id = log.append(mulliganRequest(0), mulliganResponse(false));
    expect(id).toBe(mkDecisionId(0));
  });

  it("records preserve insertion order in toArray", () => {
    const log = new DecisionLog();
    for (let i = 0; i < 5; i++) {
      log.append(priorityRequest(i % 2), priorityResponse());
    }
    const arr = log.toArray();
    for (let i = 0; i < 5; i++) {
      expect(arr[i]?.id).toBe(mkDecisionId(i));
    }
  });
});
