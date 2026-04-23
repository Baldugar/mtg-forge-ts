// SPDX-License-Identifier: GPL-3.0-or-later
export enum PhaseStep {
  Untap = 0,
  Upkeep = 1,
  Draw = 2,
  PreCombatMain = 3,
  BeginCombat = 4,
  DeclareAttackers = 5,
  DeclareBlockers = 6,
  FirstStrikeDamage = 7,
  CombatDamage = 8,
  EndOfCombat = 9,
  PostCombatMain = 10,
  EndStep = 11,
  Cleanup = 12,
}

export const canonicalPhaseSequence: readonly PhaseStep[] = [
  PhaseStep.Untap,
  PhaseStep.Upkeep,
  PhaseStep.Draw,
  PhaseStep.PreCombatMain,
  PhaseStep.BeginCombat,
  PhaseStep.DeclareAttackers,
  PhaseStep.DeclareBlockers,
  PhaseStep.FirstStrikeDamage,
  PhaseStep.CombatDamage,
  PhaseStep.EndOfCombat,
  PhaseStep.PostCombatMain,
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
