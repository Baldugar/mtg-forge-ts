// SPDX-License-Identifier: GPL-3.0-or-later
// ReplacementType — the DSL-side identifier used in a card script's
//   R:Event$ <Kind> | ...
// line. Ported 1:1 from forge.game.replacement.ReplacementType. Each
// type maps to a matcher that narrows one or more MutationIntent kinds.

export const REPLACEMENT_TYPES = [
  "AddCounter",
  "AssembleContraption",
  "AssignDealDamage",
  "Attached",
  "BeginPhase",
  "BeginTurn",
  "Cascade",
  "Counter",
  "CopySpell",
  "CreateToken",
  "DamageDone",
  "DealtDamage",
  "DeclareBlocker",
  "Destroy",
  "Draw",
  "DrawCards",
  "Explore",
  "GainLife",
  "GameLoss",
  "GameWin",
  "Learn",
  "LifeReduced",
  "LoseMana",
  "Mill",
  "Moved",
  "PayLife",
  "PlanarDiceResult",
  "Planeswalk",
  "ProduceMana",
  "Proliferate",
  "RemoveCounter",
  "RollDice",
  "RollPlanarDice",
  "Scry",
  "SetInMotion",
  "Tap",
  "Transform",
  "TurnFaceUp",
  "Untap",
] as const;

export type ReplacementType = (typeof REPLACEMENT_TYPES)[number];

const BY_LOWER = new Map<string, ReplacementType>(REPLACEMENT_TYPES.map((t) => [t.toLowerCase(), t]));

export const isReplacementType = (value: string): value is ReplacementType =>
  BY_LOWER.has(value.toLowerCase());

export const replacementTypeFromName = (name: string): ReplacementType | null =>
  BY_LOWER.get(name.toLowerCase()) ?? null;
