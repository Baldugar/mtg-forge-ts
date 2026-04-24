// SPDX-License-Identifier: GPL-3.0-or-later
// CR 601.2 — the 10 canonical cast-pipeline steps. Enum values are 1-indexed
// so tests / logs reading the step number match the rules-text numbering
// ("step 3 is zone-override") without an off-by-one.
export enum CastStep {
  Propose = 1,
  ChooseFace = 2,
  ChooseZoneOverride = 3,
  ChooseAltCosts = 4,
  ChooseModes = 5,
  DistributeX = 6,
  ChooseTargets = 7,
  DetermineTotalCost = 8,
  ActivateManaAbilities = 9,
  PayCosts = 10,
}
