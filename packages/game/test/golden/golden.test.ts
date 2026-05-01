// SPDX-License-Identifier: GPL-3.0-or-later
// Milestone 2 — golden trace regression suite.
//
// Each scenario in SCENARIOS is run twice: once to capture (or compare),
// once to verify determinism. Determinism is the critical contract — if
// run-to-run the same scenario produces a different trace, the goldens
// can't be a regression net at all.
//
// Update flow:
//   UPDATE_GOLDENS=1 pnpm --filter @mtg-forge-ts/game test golden
// Re-runs every scenario and overwrites every golden. Used after an
// intentional behaviour change.
//
// Compare flow (default):
//   pnpm --filter @mtg-forge-ts/game test golden
// Reads each golden, re-runs the scenario, asserts byte-identical trace.

import { describe, expect, it } from "vitest";
import { compareTrace, readGolden, runScenario, writeGolden } from "./runner.js";
import { SCENARIOS } from "./scenarios.js";

const UPDATE = process.env.UPDATE_GOLDENS === "1";

describe("golden traces", () => {
  // Sanity: we always have 30+ scenarios. If someone deletes the cohort
  // by accident, this fires.
  it("has at least 30 curated scenarios", () => {
    expect(SCENARIOS.length).toBeGreaterThanOrEqual(30);
  });

  it("scenario ids are unique", () => {
    const seen = new Set<string>();
    for (const s of SCENARIOS) {
      expect(seen.has(s.id)).toBe(false);
      seen.add(s.id);
    }
  });

  for (const scenario of SCENARIOS) {
    it(`${scenario.id}: ${scenario.description}`, () => {
      const trace = runScenario(scenario);
      if (UPDATE) {
        writeGolden(scenario.id, trace);
        return;
      }
      const golden = readGolden(scenario.id);
      if (!golden) {
        throw new Error(
          `golden file missing for '${scenario.id}'. Run 'UPDATE_GOLDENS=1 pnpm --filter @mtg-forge-ts/game test golden' to capture.`,
        );
      }
      const div = compareTrace(golden, trace);
      if (div) {
        const summary =
          `divergence at ${div.path}\n` +
          `  context: ${div.context}\n` +
          `  expected: ${JSON.stringify(div.expected)}\n` +
          `  actual:   ${JSON.stringify(div.actual)}`;
        throw new Error(summary);
      }
      expect(div).toBeNull();
    });

    // Determinism gate — same seed must always produce the same trace.
    // Ran inline so the failure message says which scenario broke.
    it(`${scenario.id}: deterministic (two runs identical)`, () => {
      const a = runScenario(scenario);
      const b = runScenario(scenario);
      const div = compareTrace(a, b);
      if (div) {
        throw new Error(
          `non-deterministic trace for '${scenario.id}': ${div.path} expected=${JSON.stringify(div.expected)} actual=${JSON.stringify(div.actual)}`,
        );
      }
      expect(div).toBeNull();
    });
  }
});
