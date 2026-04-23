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
    };
    expect(rules.formatId).toBe("standard");
    expect(rules.startingLife).toBe(20);
    expect(rules.playerCount.min).toBe(2);
    expect(rules.playerCount.max).toBe(2);
    expect(rules.teamAssignments).toBeUndefined();
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
      };
      expect(rules.mulliganRule).toBe(m);
    }
  });

  it("supports teamAssignments and ruleOverrides", () => {
    const rules: GameRules = {
      formatId: "two-headed-giant",
      startingLife: 30,
      startingHandSize: 7,
      mulliganRule: "london",
      firstPlayerSkipsDraw: false,
      ruleOverrides: ["sharedLife", "sharedTurns"],
      playerCount: { min: 4, max: 4 },
      teamAssignments: [0, 1, 0, 1],
    };
    expect(rules.teamAssignments).toEqual([0, 1, 0, 1]);
    expect(rules.ruleOverrides).toEqual(["sharedLife", "sharedTurns"]);
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
