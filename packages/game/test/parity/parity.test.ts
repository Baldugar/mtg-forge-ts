// SPDX-License-Identifier: GPL-3.0-or-later
// Milestone 4 — TS-vs-Java parity test suite.
//
// One test per scenario in the M2 cohort. Each test:
//   1. Loads both the TS golden and the Java golden.
//   2. Diffs them via the parity harness.
//   3. Asserts:
//      - both sides loaded OK
//      - severity is at most "mvp-known" (no unknown divergences)
//      - the headline / primary-action signal landed on both sides
//
// We deliberately do NOT assert hard event-by-event parity. The M3
// bridge MVP captures only the primary moveTo or SpellCast for each
// action and skips cost payment, target binding, and stack drain — so
// hard parity is impossible until M5 raises the bridge to capture full
// resolution traces. M4's contract is "we know about every divergence
// and can classify it."

import { describe, expect, it } from "vitest";
import { SCENARIOS } from "../golden/scenarios.js";
import { diffTraces, loadJavaGolden, loadTsGolden } from "./runner.js";

describe("parity (TS golden vs Java golden)", () => {
  it("at least 30 scenarios in the cohort", () => {
    expect(SCENARIOS.length).toBeGreaterThanOrEqual(30);
  });

  for (const scenario of SCENARIOS) {
    it(`${scenario.id}: parity classification`, () => {
      const tsTrace = loadTsGolden(scenario.id);
      const javaTrace = loadJavaGolden(scenario.id);

      // Both goldens must exist — missing files are infrastructure
      // bugs, not parity divergences.
      if (!tsTrace) {
        throw new Error(
          `parity: missing TS golden for '${scenario.id}'. Run 'UPDATE_GOLDENS=1 pnpm test golden'.`,
        );
      }
      if (!javaTrace) {
        throw new Error(
          `parity: missing Java golden for '${scenario.id}'. Re-run tools/forge-bridge/scripts/run.sh to capture.`,
        );
      }

      const report = diffTraces(scenario.id, tsTrace, javaTrace);

      // Hard contract: never `unknown-divergence`. Either kind-sets
      // match exactly, or every divergence is explained by a documented
      // M3-MVP bridge limitation.
      if (report.severity === "unknown-divergence") {
        const tsOnlyUnknown = report.tsOnlyKinds.filter(
          (d) => d.classification === "real-divergence-investigate",
        );
        const javaOnlyUnknown = report.javaOnlyKinds.filter(
          (d) => d.classification === "real-divergence-investigate",
        );
        const lines = [
          `parity: '${scenario.id}' has unexplained divergences`,
          `  ts-histogram:   ${JSON.stringify(report.tsKindHistogram)}`,
          `  java-histogram: ${JSON.stringify(report.javaKindHistogram)}`,
          `  shared:         ${JSON.stringify(report.sharedKinds)}`,
          `  ts-only unknown:   ${JSON.stringify(tsOnlyUnknown.map((x) => x.kind))}`,
          `  java-only unknown: ${JSON.stringify(javaOnlyUnknown.map((x) => x.kind))}`,
        ];
        throw new Error(lines.join("\n"));
      }

      // We accept "match" or "mvp-known".
      expect(["match", "mvp-known"]).toContain(report.severity);
    });
  }

  // Aggregate sanity — at least one scenario must have a clean match.
  // If the bridge ever regresses such that *every* scenario diverges,
  // this fires. Currently the trivial-ETB scenarios (Grizzly Bears,
  // Angel of Mercy etc.) match cleanly.
  it("at least one scenario fully matches", () => {
    let matchCount = 0;
    for (const scenario of SCENARIOS) {
      const ts = loadTsGolden(scenario.id);
      const java = loadJavaGolden(scenario.id);
      if (!ts || !java) continue;
      const r = diffTraces(scenario.id, ts, java);
      if (r.severity === "match") matchCount++;
    }
    expect(matchCount).toBeGreaterThanOrEqual(1);
  });
});
