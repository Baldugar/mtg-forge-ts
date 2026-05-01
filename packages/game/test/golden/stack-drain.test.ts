// SPDX-License-Identifier: GPL-3.0-or-later
// Testing M2.5 — TS runner V2 stack-drain unit coverage.
//
// Verifies that the golden runner's `runStackUntilEmpty` post-action drain
// produces the post-resolution events Bridge V2 sees on the Forge side:
// triggered abilities resolve to completion (Mulldrifter draws 2), and
// disabling the drain via `drainStack: false` returns the legacy single-
// action capture (no trigger fan-out). These complement the per-scenario
// goldens — those lock the full trace contents; these isolate the drain
// behaviour itself so a regression in `runStackUntilEmpty` shows here
// before the goldens have to be re-captured.

import { describe, expect, it } from "vitest";
import { runScenario } from "./runner.js";
import { SCENARIOS } from "./scenarios.js";

const findScenario = (id: string) => {
  const sc = SCENARIOS.find((s) => s.id === id);
  if (!sc) throw new Error(`stack-drain.test: scenario '${id}' not present in cohort`);
  return sc;
};

describe("Testing M2.5 — TS runner V2 stack drain", () => {
  it("Mulldrifter ETB → drain resolves the draw-2 trigger end-to-end", () => {
    const trace = runScenario(findScenario("mulldrifter-etb-draw"));
    const cardDrawn = trace.events.filter((e) => e.kind === "CardDrawn");
    // CR 700.4 — Mulldrifter's "When ~ enters, draw 2 cards" should fire
    // its trigger and resolve it under the drain. Two CardDrawn events
    // confirm the resolver ran end-to-end.
    expect(cardDrawn).toHaveLength(2);
    // StackItemResolved for the trigger — the marker that the drain
    // pumped the resolver to completion (resolveStackItem emits this
    // post-resolution).
    const resolved = trace.events.filter((e) => e.kind === "StackItemResolved");
    expect(resolved.length).toBeGreaterThanOrEqual(1);
    // Hand size grew by 2 (Mulldrifter no longer in hand at scenario start
    // — the scenario seeds it to battlefield directly via etb).
    expect(trace.finalState.handSizes[0]).toBe(2);
  });

  it("Soul Warden + Angel chain → both triggers fire under one drain", () => {
    const trace = runScenario(findScenario("soul-warden-angel-chain"));
    // Two LifeChanged events: Soul Warden's gain-1 + Angel of Mercy's gain-3
    // (when Angel ETBs both Warden and Angel see the trigger event; Angel's
    // own gain-3 fires too). Final life total = 20 + 3 + 1 = 24.
    const lifeChanged = trace.events.filter((e) => e.kind === "LifeChanged");
    expect(lifeChanged.length).toBeGreaterThanOrEqual(2);
    expect(trace.finalState.lifeTotals[0]).toBe(24);
    // Two StackItemResolved (one per triggered ability resolution).
    const resolved = trace.events.filter((e) => e.kind === "StackItemResolved");
    expect(resolved.length).toBeGreaterThanOrEqual(2);
  });

  it("drainStack: false skips the post-action drain (legacy single-action mode)", () => {
    const sc = findScenario("mulldrifter-etb-draw");
    const trace = runScenario(sc, { drainStack: false });
    // Without drain, the ETB trigger queues but never resolves — no
    // CardDrawn events appear, Mulldrifter's hand stays at 0.
    const cardDrawn = trace.events.filter((e) => e.kind === "CardDrawn");
    expect(cardDrawn).toHaveLength(0);
    expect(trace.finalState.handSizes[0]).toBe(0);
  });
});
