// SPDX-License-Identifier: GPL-3.0-or-later
// Ninjutsu (CR 702.49) state-mutation primitive — SP2 Task 50.
import type { LobbyPlayer } from "@mtg-forge-ts/core";
import { SeededRng, mkEntityId, mkPlayerSeat } from "@mtg-forge-ts/core";
import { describe, expect, it } from "vitest";
import type { GameMeta } from "../../game-meta.js";
import type { GameRules } from "../../game-rules.js";
import { Game } from "../../game.js";
import { CombatHandler } from "../combat-handler.js";
import { ninjutsuSwap } from "./ninjutsu.js";

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
describe("ninjutsuSwap (CR 702.49)", () => {
  it("swaps an unblocked attacker for a new attacker from hand", () => {
    const game = new Game({ lobbyPlayers: [alice, bob], rules, meta, rng: new SeededRng(1n) });
    const handler = new CombatHandler(game);
    const oldAtt = mkEntityId(1);
    const newAtt = mkEntityId(2);
    const seatB = mkPlayerSeat(1);
    handler.declareAttackers([{ attackerId: oldAtt, defender: { kind: "player", seat: seatB } }]);
    ninjutsuSwap(handler, oldAtt, newAtt);
    expect(handler.state.attackers.has(oldAtt)).toBe(false);
    expect(handler.state.attackers.has(newAtt)).toBe(true);
    const newInfo = handler.state.attackers.get(newAtt);
    expect(newInfo?.defender).toEqual({ kind: "player", seat: seatB });
    expect(newInfo?.isTapped).toBe(false);
  });
  it("throws when the attacker isn't declared", () => {
    const game = new Game({ lobbyPlayers: [alice, bob], rules, meta, rng: new SeededRng(1n) });
    const handler = new CombatHandler(game);
    expect(() => ninjutsuSwap(handler, mkEntityId(999), mkEntityId(2))).toThrow(/not declared/);
  });
  it("throws when the attacker is blocked", () => {
    const game = new Game({ lobbyPlayers: [alice, bob], rules, meta, rng: new SeededRng(1n) });
    const handler = new CombatHandler(game);
    const oldAtt = mkEntityId(1);
    const newAtt = mkEntityId(2);
    const blocker = mkEntityId(10);
    const seatB = mkPlayerSeat(1);
    handler.declareAttackers([{ attackerId: oldAtt, defender: { kind: "player", seat: seatB } }]);
    handler.declareBlockers([{ blockerId: blocker, attackerIds: [oldAtt] }]);
    handler.setBlockerOrder(oldAtt, [blocker]);
    expect(() => ninjutsuSwap(handler, oldAtt, newAtt)).toThrow(/blocked/);
  });
});
