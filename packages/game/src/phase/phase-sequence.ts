// SPDX-License-Identifier: GPL-3.0-or-later
// PhaseSequence — mutable, per-turn list of PhaseSteps that drives the turn
// walker. Defaults to core's canonicalPhaseSequence (Untap → … → Cleanup).
//
// SP1 mutation points:
//   - injectExtraCombat: Relentless Assault-style effects append a second
//     combat block after EndOfCombat.
//   - skipStep / isSkipped: Eon Hub-style effects drop a step entirely.
//   - reset: restores the canonical sequence between turns.
//
// SP2 will layer per-turn "skipped phases" state (game.flags.skippedPhases)
// into this class; for SP1 the mutation methods are direct.
import { PhaseStep, canonicalPhaseSequence } from "@mtg-forge-ts/core";

export class PhaseSequence {
  private steps: PhaseStep[] = [...canonicalPhaseSequence];

  getSteps(): readonly PhaseStep[] {
    return this.steps;
  }

  reset(): void {
    this.steps = [...canonicalPhaseSequence];
  }

  // Relentless Assault / Savage Beating: splice a full combat block in
  // immediately after the first EndOfCombat. WHY include FirstStrikeDamage:
  // the canonical phase.ts sequence has it as a distinct step, so the
  // duplicated block preserves the same shape.
  injectExtraCombat(): void {
    const idx = this.steps.indexOf(PhaseStep.EndOfCombat);
    if (idx < 0) return;
    this.steps.splice(
      idx + 1,
      0,
      PhaseStep.BeginCombat,
      PhaseStep.DeclareAttackers,
      PhaseStep.DeclareBlockers,
      PhaseStep.FirstStrikeDamage,
      PhaseStep.CombatDamage,
      PhaseStep.EndOfCombat,
    );
  }

  skipStep(s: PhaseStep): void {
    this.steps = this.steps.filter((x) => x !== s);
  }

  isSkipped(s: PhaseStep): boolean {
    return !this.steps.includes(s);
  }
}
