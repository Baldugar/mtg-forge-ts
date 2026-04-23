// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from "vitest";
import type { GameMeta } from "./game-meta.js";
import type { GameRules } from "./game-rules.js";

describe("GameRules + GameMeta", () => {
  it("constructs a minimal standard-duel GameRules literal", () => {
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
    expect(rules.formatId).toBe("standard");
    expect(rules.startingLife).toBe(20);
    expect(rules.playerCount.min).toBe(2);
    expect(rules.playerCount.max).toBe(2);
    expect(rules.teamAssignments).toBeUndefined();
    expect(rules.poisonCountersToLose).toBe(10);
    expect(rules.playForAnte).toBe(false);
    expect(rules.manaBurn).toBe(false);
    expect(rules.appliedVariants).toEqual([]);
  });

  it("accepts all mulliganRule variants", () => {
    const variants: GameRules["mulliganRule"][] = ["london", "vancouver", "paris", "free"];
    for (const m of variants) {
      const rules: GameRules = {
        formatId: "f",
        startingLife: 20,
        startingHandSize: 7,
        mulliganRule: m,
        firstPlayerSkipsDraw: true,
        ruleOverrides: [],
        playerCount: { min: 2, max: 2 },
        poisonCountersToLose: 10,
        playForAnte: false,
        manaBurn: false,
        appliedVariants: [],
      };
      expect(rules.mulliganRule).toBe(m);
    }
  });

  it("supports teamAssignments, ruleOverrides, and 2HG poison override", () => {
    const rules: GameRules = {
      formatId: "two-headed-giant",
      startingLife: 30,
      startingHandSize: 7,
      mulliganRule: "london",
      firstPlayerSkipsDraw: false,
      ruleOverrides: ["sharedLife", "sharedTurns"],
      playerCount: { min: 4, max: 4 },
      teamAssignments: [0, 1, 0, 1],
      poisonCountersToLose: 15,
      playForAnte: false,
      manaBurn: false,
      appliedVariants: ["TwoHeadedGiant"],
    };
    expect(rules.teamAssignments).toEqual([0, 1, 0, 1]);
    expect(rules.ruleOverrides).toEqual(["sharedLife", "sharedTurns"]);
    expect(rules.poisonCountersToLose).toBe(15);
    expect(rules.appliedVariants).toEqual(["TwoHeadedGiant"]);
  });

  it("accepts applied-variants stacking (Commander + Planechase)", () => {
    const rules: GameRules = {
      formatId: "commander",
      startingLife: 40,
      startingHandSize: 7,
      mulliganRule: "london",
      firstPlayerSkipsDraw: false,
      ruleOverrides: [],
      playerCount: { min: 2, max: 4 },
      poisonCountersToLose: 10,
      playForAnte: false,
      manaBurn: false,
      appliedVariants: ["Commander", "Planechase"],
    };
    expect(rules.appliedVariants).toEqual(["Commander", "Planechase"]);
  });

  it("accepts match-length fields (Bo3 / Bo5 / single-game)", () => {
    const bo3: GameRules = {
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
      gamesPerMatch: 3,
      gamesToWinMatch: 2,
    };
    expect(bo3.gamesPerMatch).toBe(3);
    expect(bo3.gamesToWinMatch).toBe(2);
  });

  it("GameRules JSON round-trip is identity", () => {
    const rules: GameRules = {
      formatId: "commander",
      startingLife: 40,
      startingHandSize: 7,
      mulliganRule: "london",
      firstPlayerSkipsDraw: false,
      ruleOverrides: [],
      playerCount: { min: 2, max: 4 },
      poisonCountersToLose: 21,
      playForAnte: true,
      manaBurn: false,
      appliedVariants: ["Commander"],
    };
    const rt = JSON.parse(JSON.stringify(rules)) as GameRules;
    expect(rt).toEqual(rules);
  });

  it("GameMeta carries engine + card-data + seed provenance", () => {
    const meta: GameMeta = {
      engineVersion: "0.0.0",
      forgeSha: "deadbeefcafe",
      cardDataSyncedAt: "2026-04-23T00:00:00Z",
      crVersion: "2024-11-08",
      seed: "ff00aabb",
    };
    expect(meta.engineVersion).toBe("0.0.0");
    expect(meta.seed).toBe("ff00aabb");
  });

  it("GameMeta JSON round-trip is identity", () => {
    const meta: GameMeta = {
      engineVersion: "0.0.0",
      forgeSha: "abc",
      cardDataSyncedAt: "2026-04-23T00:00:00Z",
      crVersion: "2024-11-08",
      seed: "01",
    };
    const rt = JSON.parse(JSON.stringify(meta)) as GameMeta;
    expect(rt).toEqual(meta);
  });
});
