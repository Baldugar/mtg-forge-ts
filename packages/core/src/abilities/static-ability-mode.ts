// SPDX-License-Identifier: GPL-3.0-or-later
// StaticAbilityMode — 83-entry enum ported from Forge's
// forge-game/.../staticability/StaticAbilityMode.java (Forge order
// preserved). Each mode maps to exactly one StaticAbilityCategory
// (total function); SP3 card ports set precise modes per Forge script
// semantics.
//
// Wave 60 — `DontUntap` (Stasis-style "permanents don't untap during
// their controller's untap step") added; Forge's StaticAbilityMode.java
// has it under the AttackVigilance / Untap family even though it isn't
// a combat-vigilance mode per se. Mapped to the cantMustMay category
// (action-filter consulted by the untap loop) — see MODE_TO_CATEGORY.
//
// Wave 60.C — `MayBeCastBy` (positive cast-permission gate; CR 601;
// Bolas's Citadel / Oracle of Mul Daya / Sen Triplets / Wishclaw Talisman)
// and `MaxLevel` (Class enchantment level-up cap; CR 716) added. Both
// share the same shape as the Wave 60.A gates: registry-walk consulted
// at a decision point. See MODE_TO_CATEGORY for category routing.
import type { StaticAbilityCategory } from "./static-ability.js";

/** All Forge static-ability modes, in Forge enum declaration order. */
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
  // Wave 60 — Stasis-style "permanents don't untap during their controller's
  // untap step". Action-filter consulted by phase-handler's untap loop.
  "DontUntap",
  // Wave 60.C — Positive cast-permission gate (CR 601). Bolas's Citadel /
  // Oracle of Mul Daya / Sen Triplets / Wishclaw Talisman / Knowledge Pool
  // grant a player permission to cast a card matching ValidCard$ from a
  // zone where it would otherwise be illegal to cast it.
  "MayBeCastBy",
  // Wave 60.C — Class enchantment level-up cap (CR 716). The level-up
  // activated SA refuses to fire when classLevel >= classMaxLevel.
  "MaxLevel",
  // Wave 60.D — Two turn-structure state-modifier statics. Both routed
  // ruleChanging because they override the canonical turn structure
  // rather than acting as action filters.
  // LimitOnHandSize (CR 402.2) — overrides a player's max hand size at
  // cleanup. Reliquary Tower / Spellbook / Library of Leng / Thought Vessel.
  "LimitOnHandSize",
  // AdditionalCombatPhase (CR 506) — grants the active player an extra
  // combat phase + main phase after the current combat. Aurelia, the
  // Warleader's static-emblem form; the activated/sorcery forms (Aggravated
  // Assault / Relentless Assault / Hellkite Charger / Combat Celebrant) use
  // the AB$ AdditionalCombat effect instead.
  "AdditionalCombatPhase",
  // Wave 60.E — three same-shape damage-prevention statics (CR 615).
  // PreventAllDamage is the global Fog-shape prevention (no filter);
  // PreventAllDamageBy filters on ValidSource$; PreventAllDamageTo on
  // ValidTarget$. All three additionally honor a Combat$ True/False
  // filter and route via replacementGenerating — the GameAction.damage
  // call site consults wouldPreventDamage before constructing the
  // DamageIntent, emits a DamagePrevented event on match, and bails
  // before any DamageDealt fires (Forge's silent-prevention semantics).
  "PreventAllDamage",
  "PreventAllDamageBy",
  "PreventAllDamageTo",
  // Wave 60.G — three same-shape turn-structure phase-step modifier
  // statics, all routed via ruleChanging (they override the canonical
  // turn structure). Consulted by the phase handler at the respective
  // step entry points.
  // SkipUntap (CR 502.1) — Stasis / Eon Hub / Curse of Misfortunes:
  // matched player skips their untap step entirely. Distinct from
  // DontUntap which keeps the step but blocks specific permanents.
  "SkipUntap",
  // SkipDraw (CR 504.1) — The Abyss-style enchantments / Wheel of
  // Sun and Moon: matched player skips their draw step entirely.
  "SkipDraw",
  // AdditionalUntapStep (CR 502) — Awakening Zone / Time Vault
  // analogues: insert an additional untap step at the start of the
  // matched player's turn. Stamps a per-seat counter consumed by the
  // phase handler right after the normal untap (MVP ordering).
  "AdditionalUntapStep",
  // Wave 60.H — CantSearchLibrary (CR 701.18). Mindlock Orb /
  // Stranglehold — the matched player can't search any library. Forge
  // expresses this as Continuous + AddKeyword$ CantSearchLibrary; we
  // also accept the direct Mode$ CantSearchLibrary form. Action filter,
  // routed via cantMustMay; consulted by SeekEffect / TransmuteEffect
  // / TransfigureEffect / library-search call sites.
  "CantSearchLibrary",
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
  // Wave 60 — DontUntap is consulted by the untap-step loop as an action
  // filter (the engine asks "may this permanent untap?" before applying
  // the untap). Lives in the cantMustMay bucket alongside CantAttack/CantBlock.
  DontUntap: "cantMustMay",
  // Wave 60.C — MaxLevel is an action-filter on the Class level-up
  // activated SA (refuses to fire when classLevel >= classMaxLevel). The
  // gate is consulted at the activate-time path; the static itself
  // stamps card.classMaxLevel on the source, so the consumer reads from
  // the card slot directly. Routing via cantMustMay keeps the registry
  // hookup uniform.
  MaxLevel: "cantMustMay",

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
  // Wave 60.C — MayBeCastBy positively grants a player permission to cast
  // a card from a zone where it would otherwise be illegal (Bolas's
  // Citadel / Oracle of Mul Daya). Routing via ruleChanging mirrors the
  // CastWithFlash sibling (also a positive cast permission, also
  // ruleChanging) — both override the default cast rules.
  MayBeCastBy: "ruleChanging",
  // Wave 60.D — turn-structure modifier statics. Both override CR-prescribed
  // turn / phase behavior, so they live in ruleChanging alongside the other
  // turn/phase rule overrides (TurnReversed, PhaseReversed).
  LimitOnHandSize: "ruleChanging",
  AdditionalCombatPhase: "ruleChanging",
  // Wave 60.E — damage-prevention statics. Routed via replacementGenerating
  // alongside the rest of the Cant* damage / life family (CantPreventDamage,
  // CantGainLife, CantLoseLife, etc.) — the consumer site (GameAction.damage)
  // walks the registry before constructing the DamageIntent and bails
  // silently on a match (mirrors Forge's StaticAbilityPreventDamage path).
  PreventAllDamage: "replacementGenerating",
  PreventAllDamageBy: "replacementGenerating",
  PreventAllDamageTo: "replacementGenerating",
  // Wave 60.G — turn-structure phase-step modifier statics. All three
  // override CR-prescribed turn structure (skip a step / inject an extra
  // step), so they live in ruleChanging alongside AdditionalCombatPhase /
  // TurnReversed / PhaseReversed.
  SkipUntap: "ruleChanging",
  SkipDraw: "ruleChanging",
  AdditionalUntapStep: "ruleChanging",
  // Wave 60.H — CantSearchLibrary (CR 701.18). Pure action filter
  // consulted by library-search call sites (SeekEffect / TransmuteEffect
  // / TransfigureEffect / etc.) — bails before the library scan and
  // emits no event on match. Lives in cantMustMay alongside CantAttack /
  // CantBlock / DontUntap. CantSacrifice and CantTransform are already
  // mapped above (replacementGenerating) — Wave 60.H wires their
  // handlers without changing routing.
  CantSearchLibrary: "cantMustMay",
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
