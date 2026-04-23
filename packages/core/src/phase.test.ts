// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from "vitest";
import { PhaseStep, canonicalPhaseSequence, isCombatStep } from "./phase.js";

describe("PhaseStep", () => {
  it("defines 13 canonical steps (string-valued enum)", () => {
    const keys = Object.keys(PhaseStep);
    expect(keys).toEqual([
      "Untap",
      "Upkeep",
      "Draw",
      "Main1",
      "BeginCombat",
      "DeclareAttackers",
      "DeclareBlockers",
      "FirstStrikeDamage",
      "CombatDamage",
      "EndOfCombat",
      "Main2",
      "EndStep",
      "Cleanup",
    ]);
  });

  it("string values match enum names verbatim (Forge-compatible wire format)", () => {
    expect(PhaseStep.Main1).toBe("Main1");
    expect(PhaseStep.Main2).toBe("Main2");
    expect(PhaseStep.BeginCombat).toBe("BeginCombat");
    expect(PhaseStep.Untap).toBe("Untap");
  });

  it("canonicalPhaseSequence has 13 steps in correct order", () => {
    expect(canonicalPhaseSequence.length).toBe(13);
    expect(canonicalPhaseSequence[0]).toBe(PhaseStep.Untap);
    expect(canonicalPhaseSequence[3]).toBe(PhaseStep.Main1);
    expect(canonicalPhaseSequence[10]).toBe(PhaseStep.Main2);
    expect(canonicalPhaseSequence[12]).toBe(PhaseStep.Cleanup);
  });

  it("isCombatStep identifies the 6 combat steps", () => {
    expect(isCombatStep(PhaseStep.BeginCombat)).toBe(true);
    expect(isCombatStep(PhaseStep.DeclareAttackers)).toBe(true);
    expect(isCombatStep(PhaseStep.DeclareBlockers)).toBe(true);
    expect(isCombatStep(PhaseStep.FirstStrikeDamage)).toBe(true);
    expect(isCombatStep(PhaseStep.CombatDamage)).toBe(true);
    expect(isCombatStep(PhaseStep.EndOfCombat)).toBe(true);

    expect(isCombatStep(PhaseStep.Untap)).toBe(false);
    expect(isCombatStep(PhaseStep.Main1)).toBe(false);
    expect(isCombatStep(PhaseStep.Main2)).toBe(false);
    expect(isCombatStep(PhaseStep.Cleanup)).toBe(false);
  });
});
