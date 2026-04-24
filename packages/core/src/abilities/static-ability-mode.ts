// SPDX-License-Identifier: GPL-3.0-or-later
// StaticAbilityMode — 82-entry enum ported from Forge's
// forge-game/.../staticability/StaticAbilityMode.java (Forge order
// preserved). Each mode maps to exactly one StaticAbilityCategory
// (total function); SP3 card ports set precise modes per Forge script
// semantics.
import type { StaticAbilityCategory } from "./static-ability.js";

/** All 82 Forge static-ability modes, in Forge enum declaration order. */
export const STATIC_ABILITY_MODES = [
  "Continuous",
  "CantAttackUnless",
  "CantBlockUnless",
  "OptionalAttackCost",
  "OptionalCost",
  "AlternativeCost",
  "CantBeCast",
  "CantBeActivated",
  "CantPlayLand",
  "DisableTriggers",
  "Panharmonicon",
  "MustTarget",
  "CantTarget",
  "CantAttack",
  "CanAttackDefender",
  "CantBlock",
  "CantBlockBy",
  "CanAttackIfHaste",
  "CanBlockIfReach",
  "MinMaxBlocker",
  "BlockTapped",
  "AttackVigilance",
  "MustAttack",
  "PlayerMustAttack",
  "MustBlock",
  "AssignCombatDamageAsUnblocked",
  "CombatDamageToughness",
  "ColorlessDamageSource",
  "NoCleanupDamage",
  "BlockRestrict",
  "CantGainLife",
  "CantLoseLife",
  "CantChangeLife",
  "CantPayLife",
  "RaiseCost",
  "ReduceCost",
  "SetCost",
  "IgnoreHexproof",
  "IgnoreShroud",
  "AttackRestrict",
  "AssignNoCombatDamage",
  "CanAdapt",
  "CanExhaust",
  "CantBeCopied",
  "CantBeSuspected",
  "CantBecomeMonarch",
  "CantAttach",
  "CantCrew",
  "CantDraw",
  "CantDiscard",
  "CantExile",
  "CantPhaseIn",
  "CantPhaseOut",
  "CantPreventDamage",
  "CantPutCounter",
  "CantRegenerate",
  "CantSacrifice",
  "CantTransform",
  "CantVenture",
  "CantChangeDayTime",
  "ActivateAbilityAsIfHaste",
  "CastWithFlash",
  "IgnoreLandwalk",
  "IgnoreLegendRule",
  "MaxCounter",
  "InfectDamage",
  "WitherDamage",
  "FlipCoinMod",
  "PlotZone",
  "NumLoyaltyAct",
  "Devotion",
  "GainLifeRadiation",
  "SurveilNum",
  "TapPowerValue",
  "UnspentMana",
  "ManaBurn",
  "ManaConvert",
  "UntapOtherPlayer",
  "TurnReversed",
  "PhaseReversed",
  "AttackRequirement",
  "CountersRemain",
] as const;

export type StaticAbilityMode = (typeof STATIC_ABILITY_MODES)[number];

// ---------------------------------------------------------------------------
// Mode → StaticAbilityCategory — total function (every mode covered).
// ---------------------------------------------------------------------------

const MODE_TO_CATEGORY: Record<StaticAbilityMode, StaticAbilityCategory> = {
  // continuous
  Continuous: "continuous",
  TapPowerValue: "continuous",

  // costModification
  RaiseCost: "costModification",
  ReduceCost: "costModification",
  SetCost: "costModification",

  // alternativeCost
  AlternativeCost: "alternativeCost",

  // cantMustMay (action-filter statics consulted by the decision validator)
  CantAttackUnless: "cantMustMay",
  CantBlockUnless: "cantMustMay",
  OptionalAttackCost: "cantMustMay",
  OptionalCost: "cantMustMay",
  CantBeCast: "cantMustMay",
  CantBeActivated: "cantMustMay",
  CantPlayLand: "cantMustMay",
  MustTarget: "cantMustMay",
  CantTarget: "cantMustMay",
  CantAttack: "cantMustMay",
  CanAttackDefender: "cantMustMay",
  CantBlock: "cantMustMay",
  CantBlockBy: "cantMustMay",
  CanAttackIfHaste: "cantMustMay",
  CanBlockIfReach: "cantMustMay",
  MinMaxBlocker: "cantMustMay",
  BlockTapped: "cantMustMay",
  AttackVigilance: "cantMustMay",
  MustAttack: "cantMustMay",
  PlayerMustAttack: "cantMustMay",
  MustBlock: "cantMustMay",
  BlockRestrict: "cantMustMay",
  AttackRestrict: "cantMustMay",
  AttackRequirement: "cantMustMay",

  // replacementGenerating (mutation-interception statics; generate
  // ReplacementAbility entries rather than acting as action filters)
  CantGainLife: "replacementGenerating",
  CantLoseLife: "replacementGenerating",
  CantChangeLife: "replacementGenerating",
  CantPayLife: "replacementGenerating",
  CantBeCopied: "replacementGenerating",
  CantBeSuspected: "replacementGenerating",
  CantBecomeMonarch: "replacementGenerating",
  CantAttach: "replacementGenerating",
  CantCrew: "replacementGenerating",
  CantDraw: "replacementGenerating",
  CantDiscard: "replacementGenerating",
  CantExile: "replacementGenerating",
  CantPhaseIn: "replacementGenerating",
  CantPhaseOut: "replacementGenerating",
  CantPreventDamage: "replacementGenerating",
  CantPutCounter: "replacementGenerating",
  CantRegenerate: "replacementGenerating",
  CantSacrifice: "replacementGenerating",
  CantTransform: "replacementGenerating",
  CantVenture: "replacementGenerating",
  MaxCounter: "replacementGenerating",
  CountersRemain: "replacementGenerating",

  // ruleChanging (overrides game rules)
  DisableTriggers: "ruleChanging",
  Panharmonicon: "ruleChanging",
  AssignCombatDamageAsUnblocked: "ruleChanging",
  CombatDamageToughness: "ruleChanging",
  ColorlessDamageSource: "ruleChanging",
  NoCleanupDamage: "ruleChanging",
  IgnoreHexproof: "ruleChanging",
  IgnoreShroud: "ruleChanging",
  AssignNoCombatDamage: "ruleChanging",
  CanAdapt: "ruleChanging",
  CanExhaust: "ruleChanging",
  CantChangeDayTime: "ruleChanging",
  ActivateAbilityAsIfHaste: "ruleChanging",
  CastWithFlash: "ruleChanging",
  IgnoreLandwalk: "ruleChanging",
  IgnoreLegendRule: "ruleChanging",
  InfectDamage: "ruleChanging",
  WitherDamage: "ruleChanging",
  FlipCoinMod: "ruleChanging",
  PlotZone: "ruleChanging",
  NumLoyaltyAct: "ruleChanging",
  Devotion: "ruleChanging",
  GainLifeRadiation: "ruleChanging",
  SurveilNum: "ruleChanging",
  UnspentMana: "ruleChanging",
  ManaBurn: "ruleChanging",
  ManaConvert: "ruleChanging",
  UntapOtherPlayer: "ruleChanging",
  TurnReversed: "ruleChanging",
  PhaseReversed: "ruleChanging",
};

export const staticAbilityModeCategory = (mode: StaticAbilityMode): StaticAbilityCategory =>
  MODE_TO_CATEGORY[mode];

/** Type-guard: returns true if the string is a valid StaticAbilityMode. */
export const isStaticAbilityMode = (s: string): s is StaticAbilityMode =>
  (STATIC_ABILITY_MODES as readonly string[]).includes(s);

/**
 * Case-insensitive lookup from a Forge script "Mode$" value.
 * Returns the canonical StaticAbilityMode if found, null otherwise.
 */
export const staticAbilityModeFromName = (name: string): StaticAbilityMode | null => {
  const lower = name.toLowerCase();
  for (const mode of STATIC_ABILITY_MODES) {
    if (mode.toLowerCase() === lower) return mode;
  }
  return null;
};
