// SPDX-License-Identifier: GPL-3.0-or-later
import type { LobbyPlayer } from "@mtg-forge-ts/core";
import { Cost, SeededRng } from "@mtg-forge-ts/core";
import { describe, expect, it } from "vitest";
import type { GameMeta } from "../game-meta.js";
import type { GameRules } from "../game-rules.js";
import { Game } from "../game.js";
import { ManaCostSolver } from "./mana-cost-solver.js";

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

describe("ManaCostSolver", () => {
  it("canPay throws with SP3 implementation required message", () => {
    const solver = new ManaCostSolver();
    const game = new Game({
      lobbyPlayers: [alice, bob],
      rules,
      meta,
      rng: new SeededRng(1n),
    });
    const player = game.players[0];
    if (!player) throw new Error("test setup: missing player");
    expect(() => solver.canPay(Cost.of(), player, game)).toThrow(/SP3/);
  });
});
