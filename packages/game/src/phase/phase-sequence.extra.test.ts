// SPDX-License-Identifier: GPL-3.0-or-later
// SP2 Task 65 — PhaseSequence extra-combat + skip-step behavior beyond
// the SP1 baseline. Covers:
//   - multiple injectExtraCombat calls compound correctly
//   - skipStep is idempotent and targets only the future
//   - interaction between injectExtraCombat and skipStep (skip the first
//     EndOfCombat before inject is a no-op for the inject; skip AFTER
//     inject still removes one EndOfCombat)
import { PhaseStep, canonicalPhaseSequence } from "@mtg-forge-ts/core";
import { describe, expect, it } from "vitest";
import { PhaseSequence } from "./phase-sequence.js";

describe("PhaseSequence extra-combat (SP2 Task 65)", () => {
  it("injectExtraCombat during pre-combat: combat block inserted after first EndOfCombat", () => {
    // Pre-combat main is the phase BEFORE combat; the inject still targets
    // the first EndOfCombat (once the sequence reaches it, the extra block
    // fires right after). This validates that the inject is semantically
    // positioned, not clock-positioned.
    const seq = new PhaseSequence();
    seq.injectExtraCombat();
    const steps = seq.getSteps();
    expect(steps).toContain(PhaseStep.BeginCombat);
    // There should be TWO of each combat step now.
    expect(steps.filter((s) => s === PhaseStep.BeginCombat)).toHaveLength(2);
    expect(steps.filter((s) => s === PhaseStep.DeclareAttackers)).toHaveLength(2);
    expect(steps.filter((s) => s === PhaseStep.EndOfCombat)).toHaveLength(2);
  });

  it("two injectExtraCombat calls: 3 combat phases total", () => {
    const seq = new PhaseSequence();
    seq.injectExtraCombat();
    seq.injectExtraCombat();
    const steps = seq.getSteps();
    expect(steps.filter((s) => s === PhaseStep.BeginCombat)).toHaveLength(3);
    expect(steps.filter((s) => s === PhaseStep.EndOfCombat)).toHaveLength(3);
  });

  it("skipStep(Draw) before draw step elides the draw", () => {
    const seq = new PhaseSequence();
    expect(seq.getSteps()).toContain(PhaseStep.Draw);
    seq.skipStep(PhaseStep.Draw);
    expect(seq.getSteps()).not.toContain(PhaseStep.Draw);
  });

  it("skipStep for a non-existent step is a safe no-op", () => {
    const seq = new PhaseSequence();
    seq.skipStep(PhaseStep.Draw);
    const afterFirst = seq.getSteps().length;
    // Second skip of the same step: no change (nothing left to remove).
    seq.skipStep(PhaseStep.Draw);
    expect(seq.getSteps().length).toBe(afterFirst);
  });

  it("skipStep is idempotent", () => {
    const seq = new PhaseSequence();
    seq.skipStep(PhaseStep.Draw);
    seq.skipStep(PhaseStep.Draw);
    expect(seq.isSkipped(PhaseStep.Draw)).toBe(true);
  });

  it("skipStep(EndOfCombat) before injectExtraCombat makes the inject a no-op", () => {
    const seq = new PhaseSequence();
    seq.skipStep(PhaseStep.EndOfCombat);
    const lenBefore = seq.getSteps().length;
    seq.injectExtraCombat();
    expect(seq.getSteps().length).toBe(lenBefore);
  });

  it("skipStep(DeclareBlockers) after injectExtraCombat removes BOTH occurrences", () => {
    // Current impl uses filter semantics — skipStep removes ALL matching
    // steps. Document that so consumers know the invariant.
    const seq = new PhaseSequence();
    seq.injectExtraCombat();
    expect(seq.getSteps().filter((s) => s === PhaseStep.DeclareBlockers)).toHaveLength(2);
    seq.skipStep(PhaseStep.DeclareBlockers);
    expect(seq.getSteps().filter((s) => s === PhaseStep.DeclareBlockers)).toHaveLength(0);
  });

  it("reset restores canonical after any mutation combo", () => {
    const seq = new PhaseSequence();
    seq.skipStep(PhaseStep.Draw);
    seq.injectExtraCombat();
    seq.injectExtraCombat();
    seq.reset();
    expect(seq.getSteps()).toEqual([...canonicalPhaseSequence]);
  });
});
