// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from "vitest";
import { mkPlayerSeat } from "../ids.js";
import {
  type MatchDecisionRequest,
  type MatchDecisionRequestKind,
  type MatchDecisionResponse,
  type MatchDecisionResponseKind,
  isMatchRequest,
  isMatchResponse,
} from "./match-decisions.js";

const EXPECTED_REQUEST_KINDS: readonly MatchDecisionRequestKind[] = [
  "sideboard",
  "concedeMatch",
  "acceptDrawOffer",
];

const EXPECTED_RESPONSE_KINDS: readonly MatchDecisionResponseKind[] = [
  "sideboard",
  "concedeMatch",
  "acceptDrawOffer",
];

describe("MatchDecisionRequest enumeration", () => {
  it("has 3 distinct kinds (spec §4)", () => {
    expect(EXPECTED_REQUEST_KINDS.length).toBe(3);
    expect(new Set(EXPECTED_REQUEST_KINDS).size).toBe(3);
  });
});

describe("MatchDecisionResponse enumeration", () => {
  it("has 3 distinct kinds set-equal to request kinds", () => {
    expect(EXPECTED_RESPONSE_KINDS.length).toBe(3);
    expect(new Set(EXPECTED_RESPONSE_KINDS)).toEqual(new Set(EXPECTED_REQUEST_KINDS));
  });
});

describe("MatchDecisionRequest — representative construction + round-trip", () => {
  it("sideboard request with empty decks", () => {
    const req: MatchDecisionRequest = {
      kind: "sideboard",
      playerSeat: mkPlayerSeat(0),
      mainDeck: [],
      sideboard: [],
      format: "standard",
    };
    expect(isMatchRequest(req, "sideboard")).toBe(true);
    if (isMatchRequest(req, "sideboard")) {
      expect(req.format).toBe("standard");
    }
    expect(JSON.parse(JSON.stringify(req))).toEqual(req);
  });

  it("concedeMatch request", () => {
    const req: MatchDecisionRequest = { kind: "concedeMatch", playerSeat: mkPlayerSeat(1) };
    if (isMatchRequest(req, "concedeMatch")) {
      expect(req.playerSeat).toBe(mkPlayerSeat(1));
    }
    expect(JSON.parse(JSON.stringify(req))).toEqual(req);
  });

  it("acceptDrawOffer request tags the offering seat", () => {
    const req: MatchDecisionRequest = {
      kind: "acceptDrawOffer",
      playerSeat: mkPlayerSeat(0),
      offeredBy: mkPlayerSeat(1),
    };
    if (isMatchRequest(req, "acceptDrawOffer")) {
      expect(req.offeredBy).toBe(mkPlayerSeat(1));
    }
    expect(JSON.parse(JSON.stringify(req))).toEqual(req);
  });
});

describe("MatchDecisionResponse — representative construction + round-trip", () => {
  it("sideboard response with new deck assignments", () => {
    const resp: MatchDecisionResponse = {
      kind: "sideboard",
      newMainDeck: [],
      newSideboard: [],
    };
    expect(isMatchResponse(resp, "sideboard")).toBe(true);
    expect(JSON.parse(JSON.stringify(resp))).toEqual(resp);
  });

  it("concedeMatch decline (concede=false returns to match)", () => {
    const resp: MatchDecisionResponse = { kind: "concedeMatch", concede: false };
    if (isMatchResponse(resp, "concedeMatch")) {
      expect(resp.concede).toBe(false);
    }
  });

  it("acceptDrawOffer accept=true", () => {
    const resp: MatchDecisionResponse = { kind: "acceptDrawOffer", accept: true };
    if (isMatchResponse(resp, "acceptDrawOffer")) {
      expect(resp.accept).toBe(true);
    }
  });
});
