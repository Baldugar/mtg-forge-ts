// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from "vitest";
import { DEFAULT_PAPER_CARD_FLAGS, type PaperCard } from "../card/paper-card.js";
import { mkPlayerSeat } from "../ids.js";
import {
  type DraftDecisionRequest,
  type DraftDecisionRequestKind,
  type DraftDecisionResponse,
  type DraftDecisionResponseKind,
  isDraftRequest,
  isDraftResponse,
} from "./draft-decisions.js";

// WHY: lightweight PaperCard fixture used across draft tests — avoids pulling
// in fixture cards from the cards package (out of scope for core tests).
const makeCard = (name: string, collectorNumber: string): PaperCard => ({
  name,
  set: "TST",
  collectorNumber,
  language: "en",
  foil: false,
  flags: DEFAULT_PAPER_CARD_FLAGS,
});

const EXPECTED_REQUEST_KINDS: readonly DraftDecisionRequestKind[] = [
  "pick",
  "jumpstartPick",
  "winstonPile",
  "solomonSplit",
  "gridPick",
  "rochesterPick",
  "draftMulligan",
];

const EXPECTED_RESPONSE_KINDS: readonly DraftDecisionResponseKind[] = [
  "pick",
  "jumpstartPick",
  "winstonPile",
  "solomonSplit",
  "gridPick",
  "rochesterPick",
  "draftMulligan",
];

describe("DraftDecisionRequest enumeration", () => {
  it("has 7 distinct kinds (SP7 §3)", () => {
    expect(EXPECTED_REQUEST_KINDS.length).toBe(7);
    expect(new Set(EXPECTED_REQUEST_KINDS).size).toBe(7);
  });
});

describe("DraftDecisionResponse enumeration", () => {
  it("has 7 distinct kinds set-equal to request kinds", () => {
    expect(EXPECTED_RESPONSE_KINDS.length).toBe(7);
    expect(new Set(EXPECTED_RESPONSE_KINDS)).toEqual(new Set(EXPECTED_REQUEST_KINDS));
  });
});

describe("DraftDecisionRequest — representative construction", () => {
  it("standard booster pick", () => {
    const req: DraftDecisionRequest = {
      kind: "pick",
      playerSeat: mkPlayerSeat(0),
      pack: [makeCard("A", "1"), makeCard("B", "2"), makeCard("C", "3")],
      pickNumber: 1,
      packNumber: 1,
    };
    expect(isDraftRequest(req, "pick")).toBe(true);
    if (isDraftRequest(req, "pick")) {
      expect(req.pack.length).toBe(3);
    }
    expect(JSON.parse(JSON.stringify(req))).toEqual(req);
  });

  it("jumpstart pick offering two themes", () => {
    const req: DraftDecisionRequest = {
      kind: "jumpstartPick",
      playerSeat: mkPlayerSeat(0),
      themes: [
        { themeId: "goblins", name: "Goblins", cards: [makeCard("Goblin", "1")] },
        { themeId: "spirits", name: "Spirits", cards: [makeCard("Spirit", "2")] },
      ],
    };
    if (isDraftRequest(req, "jumpstartPick")) {
      expect(req.themes.length).toBe(2);
    }
    expect(JSON.parse(JSON.stringify(req))).toEqual(req);
  });

  it("winston piles with optional top card", () => {
    const req: DraftDecisionRequest = {
      kind: "winstonPile",
      playerSeat: mkPlayerSeat(1),
      piles: [
        { id: "p1", count: 3, topCard: makeCard("Top", "5") },
        { id: "p2", count: 2 },
        { id: "p3", count: 4 },
      ],
    };
    if (isDraftRequest(req, "winstonPile")) {
      expect(req.piles[0]?.topCard?.name).toBe("Top");
      expect(req.piles[1]?.topCard).toBeUndefined();
    }
    expect(JSON.parse(JSON.stringify(req))).toEqual(req);
  });

  it("solomon split (role=splitter) vs solomon choose (role=chooser)", () => {
    const splitterReq: DraftDecisionRequest = {
      kind: "solomonSplit",
      playerSeat: mkPlayerSeat(0),
      role: "splitter",
      cards: [makeCard("X", "1"), makeCard("Y", "2"), makeCard("Z", "3")],
    };
    const chooserReq: DraftDecisionRequest = {
      kind: "solomonSplit",
      playerSeat: mkPlayerSeat(1),
      role: "chooser",
      cards: [],
      groupA: [makeCard("X", "1")],
      groupB: [makeCard("Y", "2"), makeCard("Z", "3")],
    };
    if (isDraftRequest(splitterReq, "solomonSplit")) {
      expect(splitterReq.role).toBe("splitter");
    }
    if (isDraftRequest(chooserReq, "solomonSplit")) {
      expect(chooserReq.role).toBe("chooser");
      expect(chooserReq.groupA?.length).toBe(1);
      expect(chooserReq.groupB?.length).toBe(2);
    }
    expect(JSON.parse(JSON.stringify(splitterReq))).toEqual(splitterReq);
    expect(JSON.parse(JSON.stringify(chooserReq))).toEqual(chooserReq);
  });

  it("grid pick 3x3", () => {
    const req: DraftDecisionRequest = {
      kind: "gridPick",
      playerSeat: mkPlayerSeat(0),
      grid: [
        [makeCard("a1", "1"), makeCard("a2", "2"), makeCard("a3", "3")],
        [makeCard("b1", "4"), makeCard("b2", "5"), makeCard("b3", "6")],
        [makeCard("c1", "7"), makeCard("c2", "8"), makeCard("c3", "9")],
      ],
    };
    if (isDraftRequest(req, "gridPick")) {
      expect(req.grid.length).toBe(3);
      expect(req.grid[0]?.length).toBe(3);
    }
  });

  it("rochester face-up pack", () => {
    const req: DraftDecisionRequest = {
      kind: "rochesterPick",
      playerSeat: mkPlayerSeat(0),
      faceUpPack: [makeCard("A", "1"), makeCard("B", "2")],
      pickNumber: 1,
      packNumber: 1,
    };
    if (isDraftRequest(req, "rochesterPick")) {
      expect(req.faceUpPack.length).toBe(2);
    }
  });

  it("draft mulligan carries reason string", () => {
    const req: DraftDecisionRequest = {
      kind: "draftMulligan",
      playerSeat: mkPlayerSeat(0),
      reason: "conspiracy: garbage pack",
    };
    if (isDraftRequest(req, "draftMulligan")) {
      expect(req.reason).toContain("conspiracy");
    }
  });
});

describe("DraftDecisionResponse — representative construction", () => {
  it("pick response carries chosen card", () => {
    const resp: DraftDecisionResponse = { kind: "pick", chosen: makeCard("A", "1") };
    expect(isDraftResponse(resp, "pick")).toBe(true);
    if (isDraftResponse(resp, "pick")) {
      expect(resp.chosen.name).toBe("A");
    }
    expect(JSON.parse(JSON.stringify(resp))).toEqual(resp);
  });

  it("jumpstart response carries themeId", () => {
    const resp: DraftDecisionResponse = { kind: "jumpstartPick", themeId: "goblins" };
    if (isDraftResponse(resp, "jumpstartPick")) {
      expect(resp.themeId).toBe("goblins");
    }
  });

  it("winston take vs pass", () => {
    const take: DraftDecisionResponse = {
      kind: "winstonPile",
      action: "take",
      pileIdIfTake: "p2",
    };
    const pass: DraftDecisionResponse = { kind: "winstonPile", action: "next" };
    if (isDraftResponse(take, "winstonPile")) {
      expect(take.action).toBe("take");
      expect(take.pileIdIfTake).toBe("p2");
    }
    if (isDraftResponse(pass, "winstonPile")) {
      expect(pass.action).toBe("next");
      expect(pass.pileIdIfTake).toBeUndefined();
    }
  });

  it("solomon splitter response (two groups)", () => {
    const resp: DraftDecisionResponse = {
      kind: "solomonSplit",
      role: "splitter",
      groupA: [makeCard("A", "1")],
      groupB: [makeCard("B", "2"), makeCard("C", "3")],
    };
    if (isDraftResponse(resp, "solomonSplit") && resp.role === "splitter") {
      expect(resp.groupA.length).toBe(1);
      expect(resp.groupB.length).toBe(2);
    }
    expect(JSON.parse(JSON.stringify(resp))).toEqual(resp);
  });

  it("solomon chooser response (chosenGroup)", () => {
    const resp: DraftDecisionResponse = {
      kind: "solomonSplit",
      role: "chooser",
      chosenGroup: "a",
    };
    if (isDraftResponse(resp, "solomonSplit") && resp.role === "chooser") {
      expect(resp.chosenGroup).toBe("a");
    }
  });

  it("grid pick row or column", () => {
    const rowPick: DraftDecisionResponse = { kind: "gridPick", row: 1 };
    const colPick: DraftDecisionResponse = { kind: "gridPick", column: 2 };
    if (isDraftResponse(rowPick, "gridPick")) {
      expect(rowPick.row).toBe(1);
      expect(rowPick.column).toBeUndefined();
    }
    if (isDraftResponse(colPick, "gridPick")) {
      expect(colPick.column).toBe(2);
      expect(colPick.row).toBeUndefined();
    }
  });

  it("rochester pick carries chosen card", () => {
    const resp: DraftDecisionResponse = { kind: "rochesterPick", chosen: makeCard("R", "1") };
    if (isDraftResponse(resp, "rochesterPick")) {
      expect(resp.chosen.name).toBe("R");
    }
  });

  it("draft mulligan response is a boolean", () => {
    const yes: DraftDecisionResponse = { kind: "draftMulligan", mulligan: true };
    const no: DraftDecisionResponse = { kind: "draftMulligan", mulligan: false };
    if (isDraftResponse(yes, "draftMulligan")) {
      expect(yes.mulligan).toBe(true);
    }
    if (isDraftResponse(no, "draftMulligan")) {
      expect(no.mulligan).toBe(false);
    }
  });
});
