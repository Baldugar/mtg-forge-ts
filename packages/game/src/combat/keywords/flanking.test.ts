// SPDX-License-Identifier: GPL-3.0-or-later
// Flanking (CR 702.25) — SP2 Task 50. Tests the keyword-presence check
// + debuff-should-apply predicate.
import type { LobbyPlayer, PaperCard } from "@mtg-forge-ts/core";
import { DEFAULT_PAPER_CARD_FLAGS, SeededRng, ZoneType, mkEntityId, mkPlayerSeat } from "@mtg-forge-ts/core";
import { describe, expect, it } from "vitest";
import { Card } from "../../card.js";
import type { GameMeta } from "../../game-meta.js";
import type { GameRules } from "../../game-rules.js";
import { Game } from "../../game.js";
import { countFlankingOn, shouldApplyFlankingDebuff } from "./flanking.js";

const alice: LobbyPlayer = { id: "p-alice", name: "Alice", controllerKind: "human" };
const bob: LobbyPlayer = { id: "p-bob", name: "Bob", controllerKind: "ai" };
const rules: GameRules = {
  formatId: "standard",
  startingLife: 20,
  startingHandSize: 7,
  mulliganRule: "london",
  firstPlayerSkipsDraw: true,
  ruleOverrides: [],
  playerCount: { min: 2, max: 2 },
  poisonCountersToLose: 10,
  playForAnte: false,
  manaBurn: false,
  appliedVariants: [],
};
const meta: GameMeta = {
  engineVersion: "0.0.0",
  forgeSha: "abc",
  cardDataSyncedAt: "2026-04-23T00:00:00Z",
  crVersion: "2024-11-08",
  seed: "01",
};
const paper: PaperCard = {
  name: "T",
  edition: "LEA",
  collectorNumber: "001",
  language: "en",
  foil: false,
  flags: DEFAULT_PAPER_CARD_FLAGS,
};

const mkGameWithCards = (ids: number[]) => {
  const game = new Game({ lobbyPlayers: [alice, bob], rules, meta, rng: new SeededRng(1n) });
  const seat = mkPlayerSeat(0);
  for (const n of ids) {
    const id = mkEntityId(n);
    game.cards.set(id, new Card(id, paper, seat, seat, ZoneType.Battlefield));
  }
  return game;
};

describe("countFlankingOn", () => {
  it("returns 0 for creature without flanking", () => {
    const g = mkGameWithCards([1]);
    expect(countFlankingOn(g, mkEntityId(1))).toBe(0);
  });
  it("returns 1 for creature with flanking keyword", () => {
    const g = mkGameWithCards([1]);
    const card = g.cards.get(mkEntityId(1));
    if (!card) throw new Error("fx");
    card.keywords = new Set(["flanking"]);
    expect(countFlankingOn(g, mkEntityId(1))).toBe(1);
  });
});

describe("shouldApplyFlankingDebuff", () => {
  it("attacker has flanking + blocker doesn't: apply", () => {
    const g = mkGameWithCards([1, 2]);
    const att = g.cards.get(mkEntityId(1));
    if (!att) throw new Error("fx");
    att.keywords = new Set(["flanking"]);
    expect(shouldApplyFlankingDebuff(g, mkEntityId(1), mkEntityId(2))).toBe(true);
  });
  it("attacker + blocker both have flanking: no debuff", () => {
    const g = mkGameWithCards([1, 2]);
    for (const n of [1, 2]) {
      const c = g.cards.get(mkEntityId(n));
      if (!c) throw new Error("fx");
      c.keywords = new Set(["flanking"]);
    }
    expect(shouldApplyFlankingDebuff(g, mkEntityId(1), mkEntityId(2))).toBe(false);
  });
  it("neither has flanking: no debuff", () => {
    const g = mkGameWithCards([1, 2]);
    expect(shouldApplyFlankingDebuff(g, mkEntityId(1), mkEntityId(2))).toBe(false);
  });
});
