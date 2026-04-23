// SPDX-License-Identifier: GPL-3.0-or-later
import { PhaseStep, canonicalPhaseSequence } from "@mtg-forge-ts/core";
import { describe, expect, it } from "vitest";
import { PhaseSequence } from "./phase-sequence.js";

describe("PhaseSequence", () => {
  it("default: getSteps returns a copy of canonicalPhaseSequence", () => {
    const seq = new PhaseSequence();
    expect(seq.getSteps()).toEqual([...canonicalPhaseSequence]);
  });

  it("skipStep removes all occurrences of the step", () => {
    const seq = new PhaseSequence();
    seq.skipStep(PhaseStep.Draw);
    expect(seq.getSteps().includes(PhaseStep.Draw)).toBe(false);
  });

  it("isSkipped returns true for a removed step and false for a still-present step", () => {
    const seq = new PhaseSequence();
    expect(seq.isSkipped(PhaseStep.Draw)).toBe(false);
    seq.skipStep(PhaseStep.Draw);
    expect(seq.isSkipped(PhaseStep.Draw)).toBe(true);
    expect(seq.isSkipped(PhaseStep.Untap)).toBe(false);
  });

  it("injectExtraCombat appends a second combat block after EndOfCombat", () => {
    const seq = new PhaseSequence();
    seq.injectExtraCombat();
    const steps = seq.getSteps();
    // Default length 13; extra combat block adds 6 steps -> 19.
    expect(steps.length).toBe(canonicalPhaseSequence.length + 6);
    const firstEndOfCombat = steps.indexOf(PhaseStep.EndOfCombat);
    // Immediately after the first EndOfCombat we expect the inserted block.
    expect(steps[firstEndOfCombat + 1]).toBe(PhaseStep.BeginCombat);
    expect(steps[firstEndOfCombat + 2]).toBe(PhaseStep.DeclareAttackers);
    expect(steps[firstEndOfCombat + 3]).toBe(PhaseStep.DeclareBlockers);
    expect(steps[firstEndOfCombat + 4]).toBe(PhaseStep.FirstStrikeDamage);
    expect(steps[firstEndOfCombat + 5]).toBe(PhaseStep.CombatDamage);
    expect(steps[firstEndOfCombat + 6]).toBe(PhaseStep.EndOfCombat);
    // Main2 must still follow the second EndOfCombat.
    expect(steps[firstEndOfCombat + 7]).toBe(PhaseStep.Main2);
  });

  it("injectExtraCombat is a no-op when EndOfCombat is not present", () => {
    const seq = new PhaseSequence();
    seq.skipStep(PhaseStep.EndOfCombat);
    const before = seq.getSteps().length;
    seq.injectExtraCombat();
    expect(seq.getSteps().length).toBe(before);
  });

  it("reset restores the default canonical sequence", () => {
    const seq = new PhaseSequence();
    seq.skipStep(PhaseStep.Draw);
    seq.injectExtraCombat();
    seq.reset();
    expect(seq.getSteps()).toEqual([...canonicalPhaseSequence]);
  });
});
