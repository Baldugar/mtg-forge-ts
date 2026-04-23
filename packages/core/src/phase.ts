// SPDX-License-Identifier: GPL-3.0-or-later
// PhaseStep — canonical 13-step MTG turn structure. String-valued enum so
// serialized event payloads and GameLog entries round-trip across the
// TS/Java boundary with stable identifiers. Forge uses the same PascalCase
// names (Untap, Upkeep, Draw, Main1, BeginCombat, DeclareAttackers,
// DeclareBlockers, FirstStrikeDamage, CombatDamage, EndOfCombat, Main2,
// EndStep, Cleanup) so wire payloads stringify identically on both sides.
export enum PhaseStep {
  Untap = "Untap",
  Upkeep = "Upkeep",
  Draw = "Draw",
  Main1 = "Main1",
  BeginCombat = "BeginCombat",
  DeclareAttackers = "DeclareAttackers",
  DeclareBlockers = "DeclareBlockers",
  FirstStrikeDamage = "FirstStrikeDamage",
  CombatDamage = "CombatDamage",
  EndOfCombat = "EndOfCombat",
  Main2 = "Main2",
  EndStep = "EndStep",
  Cleanup = "Cleanup",
}

export const canonicalPhaseSequence: readonly PhaseStep[] = [
  PhaseStep.Untap,
  PhaseStep.Upkeep,
  PhaseStep.Draw,
  PhaseStep.Main1,
  PhaseStep.BeginCombat,
  PhaseStep.DeclareAttackers,
  PhaseStep.DeclareBlockers,
  PhaseStep.FirstStrikeDamage,
  PhaseStep.CombatDamage,
  PhaseStep.EndOfCombat,
  PhaseStep.Main2,
  PhaseStep.EndStep,
  PhaseStep.Cleanup,
];

const COMBAT_STEPS: ReadonlySet<PhaseStep> = new Set([
  PhaseStep.BeginCombat,
  PhaseStep.DeclareAttackers,
  PhaseStep.DeclareBlockers,
  PhaseStep.FirstStrikeDamage,
  PhaseStep.CombatDamage,
  PhaseStep.EndOfCombat,
]);

export const isCombatStep = (s: PhaseStep): boolean => COMBAT_STEPS.has(s);
