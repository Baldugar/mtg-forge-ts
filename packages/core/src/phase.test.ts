// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from "vitest";
import { PhaseStep, canonicalPhaseSequence, isCombatStep } from "./phase.js";

describe("PhaseStep", () => {
  it("defines 13 canonical steps", () => {
    const keys = Object.keys(PhaseStep).filter((k) => Number.isNaN(Number(k)));
    expect(keys).toEqual([
      "Untap",
      "Upkeep",
      "Draw",
      "PreCombatMain",
      "BeginCombat",
      "DeclareAttackers",
      "DeclareBlockers",
      "FirstStrikeDamage",
      "CombatDamage",
      "EndOfCombat",
      "PostCombatMain",
      "EndStep",
      "Cleanup",
    ]);
  });

  it("canonicalPhaseSequence has 13 steps in correct order", () => {
    expect(canonicalPhaseSequence.length).toBe(13);
    expect(canonicalPhaseSequence[0]).toBe(PhaseStep.Untap);
    expect(canonicalPhaseSequence[3]).toBe(PhaseStep.PreCombatMain);
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
    expect(isCombatStep(PhaseStep.PreCombatMain)).toBe(false);
    expect(isCombatStep(PhaseStep.PostCombatMain)).toBe(false);
    expect(isCombatStep(PhaseStep.Cleanup)).toBe(false);
  });
});
