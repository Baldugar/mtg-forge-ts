// SPDX-License-Identifier: GPL-3.0-or-later
import type { LobbyPlayer, PaperCard } from "@mtg-forge-ts/core";
import {
  DEFAULT_PAPER_CARD_FLAGS,
  IllegalDecisionError,
  SeededRng,
  ZoneType,
  mkEntityId,
  mkPlayerSeat,
} from "@mtg-forge-ts/core";
import { describe, expect, it } from "vitest";
import { Card } from "../card.js";
import type { GameMeta } from "../game-meta.js";
import type { GameRules } from "../game-rules.js";
import { Game } from "../game.js";
import { CombatHandler } from "./combat-handler.js";

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

const mkGame = (): Game => new Game({ lobbyPlayers: [alice, bob], rules, meta, rng: new SeededRng(1n) });

describe("CombatHandler", () => {
  it("constructs with empty state", () => {
    const game = mkGame();
    const handler = new CombatHandler(game);
    expect(handler.state.attackers.size).toBe(0);
    expect(handler.state.blockers.size).toBe(0);
    expect(handler.state.blockerOrdering.size).toBe(0);
    expect(handler.state.damageAssignments.size).toBe(0);
    expect(handler.state.firstStrikeSplitActive).toBe(false);
  });

  it("declareAttackers([]) leaves attackers empty", () => {
    const handler = new CombatHandler(mkGame());
    handler.declareAttackers([]);
    expect(handler.state.attackers.size).toBe(0);
  });

  it("declareAttackers records an attacker against a player defender", () => {
    const handler = new CombatHandler(mkGame());
    const attackerId = mkEntityId(1);
    handler.declareAttackers([{ attackerId, defender: { kind: "player", seat: mkPlayerSeat(1) } }]);
    expect(handler.state.attackers.size).toBe(1);
    const info = handler.state.attackers.get(attackerId);
    // Narrow via throw so each field assertion is type-safe and a missing
    // entry surfaces as a descriptive failure rather than a chain of
    // optional-chain undefineds.
    if (!info) throw new Error("test: expected attacker info but got undefined");
    expect(info.attackerId).toBe(attackerId);
    expect(info.isTapped).toBe(false);
    expect(info.defender.kind).toBe("player");
    if (info.defender.kind === "player") {
      expect(info.defender.seat).toBe(mkPlayerSeat(1));
    }
  });

  it("declareBlockers adds blocker entries keyed by blockerId", () => {
    const handler = new CombatHandler(mkGame());
    const blockerId = mkEntityId(10);
    const attackerId = mkEntityId(1);
    handler.declareBlockers([{ blockerId, attackerIds: [attackerId] }]);
    const info = handler.state.blockers.get(blockerId);
    if (!info) throw new Error("test: expected blocker info but got undefined");
    expect(info.attackerIds).toEqual([attackerId]);
  });

  it("declareBlockers copies the attackerIds input (no aliasing)", () => {
    const handler = new CombatHandler(mkGame());
    const blockerId = mkEntityId(10);
    const attackerId = mkEntityId(1);
    const input = [attackerId];
    handler.declareBlockers([{ blockerId, attackerIds: input }]);
    // Mutating the caller's array must not affect stored state (defensive copy).
    (input as unknown as number[]).length = 0;
    expect(handler.state.blockers.get(blockerId)?.attackerIds).toEqual([attackerId]);
  });

  it("setBlockerOrder stores per-attacker ordering defensively", () => {
    const handler = new CombatHandler(mkGame());
    const attackerId = mkEntityId(1);
    const order = [mkEntityId(10), mkEntityId(11)];
    handler.setBlockerOrder(attackerId, order);
    expect(handler.state.blockerOrdering.get(attackerId)).toEqual([mkEntityId(10), mkEntityId(11)]);
    // Defensive copy: mutating caller does not affect stored order.
    order.length = 0;
    expect(handler.state.blockerOrdering.get(attackerId)).toHaveLength(2);
  });

  it("assignDamage records damage assignments for an attacker", () => {
    const handler = new CombatHandler(mkGame());
    const attackerId = mkEntityId(1);
    const targetId = mkEntityId(10);
    handler.assignDamage(attackerId, [{ targetId, amount: 3 }]);
    const got = handler.state.damageAssignments.get(attackerId);
    expect(got).toEqual([{ targetId, amount: 3 }]);
  });

  it("setFirstStrikeSplit toggles the flag", () => {
    const handler = new CombatHandler(mkGame());
    handler.setFirstStrikeSplit(true);
    expect(handler.state.firstStrikeSplitActive).toBe(true);
    handler.setFirstStrikeSplit(false);
    expect(handler.state.firstStrikeSplitActive).toBe(false);
  });

  it("clear() resets all state including the first-strike split flag", () => {
    const handler = new CombatHandler(mkGame());
    const attackerId = mkEntityId(1);
    const blockerId = mkEntityId(10);
    handler.declareAttackers([{ attackerId, defender: { kind: "player", seat: mkPlayerSeat(1) } }]);
    handler.declareBlockers([{ blockerId, attackerIds: [attackerId] }]);
    handler.setBlockerOrder(attackerId, [blockerId]);
    handler.assignDamage(attackerId, [{ targetId: blockerId, amount: 2 }]);
    handler.setFirstStrikeSplit(true);

    handler.clear();
    expect(handler.state.attackers.size).toBe(0);
    expect(handler.state.blockers.size).toBe(0);
    expect(handler.state.blockerOrdering.size).toBe(0);
    expect(handler.state.damageAssignments.size).toBe(0);
    expect(handler.state.firstStrikeSplitActive).toBe(false);
  });
});

// Audit I-13 regression — declareBlockers validates block restrictions via
// validateBlockDeclarations and throws IllegalDecisionError on violations.
describe("CombatHandler.declareBlockers — block-restriction validation (audit I-13)", () => {
  const paper: PaperCard = {
    name: "T",
    edition: "LEA",
    collectorNumber: "001",
    language: "en",
    foil: false,
    flags: DEFAULT_PAPER_CARD_FLAGS,
  };

  const addCardWithKeywords = (game: Game, id: number, seat: number, kws: readonly string[]): void => {
    const cid = mkEntityId(id);
    const card = new Card(cid, paper, mkPlayerSeat(seat), mkPlayerSeat(seat), ZoneType.Battlefield);
    card.keywords = new Set(kws);
    game.cards.set(cid, card);
  };

  it("non-flying blocker declaring against a flying attacker throws IllegalDecisionError", () => {
    const game = mkGame();
    addCardWithKeywords(game, 1, 0, ["flying"]);
    addCardWithKeywords(game, 10, 1, []);
    const handler = new CombatHandler(game);
    handler.declareAttackers([
      { attackerId: mkEntityId(1), defender: { kind: "player", seat: mkPlayerSeat(0) } },
    ]);
    expect(() =>
      handler.declareBlockers([{ blockerId: mkEntityId(10), attackerIds: [mkEntityId(1)] }]),
    ).toThrow(IllegalDecisionError);
  });

  it("flying blocker against a flying attacker succeeds", () => {
    const game = mkGame();
    addCardWithKeywords(game, 2, 0, ["flying"]);
    addCardWithKeywords(game, 20, 1, ["flying"]);
    const handler = new CombatHandler(game);
    handler.declareAttackers([
      { attackerId: mkEntityId(2), defender: { kind: "player", seat: mkPlayerSeat(0) } },
    ]);
    expect(() =>
      handler.declareBlockers([{ blockerId: mkEntityId(20), attackerIds: [mkEntityId(2)] }]),
    ).not.toThrow();
    expect(handler.state.blockers.size).toBe(1);
  });

  it("reach blocker against flying attacker succeeds", () => {
    const game = mkGame();
    addCardWithKeywords(game, 3, 0, ["flying"]);
    addCardWithKeywords(game, 30, 1, ["reach"]);
    const handler = new CombatHandler(game);
    handler.declareAttackers([
      { attackerId: mkEntityId(3), defender: { kind: "player", seat: mkPlayerSeat(0) } },
    ]);
    expect(() =>
      handler.declareBlockers([{ blockerId: mkEntityId(30), attackerIds: [mkEntityId(3)] }]),
    ).not.toThrow();
  });
});
