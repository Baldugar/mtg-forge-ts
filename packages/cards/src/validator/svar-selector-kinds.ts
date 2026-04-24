// SPDX-License-Identifier: GPL-3.0-or-later
// Registry of known SVar selector kinds. Expanded incrementally. Unknown
// kinds emit warnings — the parser doesn't fail on them.

export const KNOWN_SVAR_SELECTORS: ReadonlySet<string> = new Set([
  // Structural / pass-through node kinds (emitted by the parser as raw arg holders)
  "literal",

  // M3 numeric selectors
  "Count",
  "Number",
  "PlayerCount",
  "SumPower",
  "SumToughness",
  "SumCMC",
  "Targeted",
  "LifeTotal",
  "XChoice",
  "X",
  "Amount",
  // Object graph
  "Remembered",
  "RememberedLKI",
  "Imprinted",
  "Paid",
  // Control/ownership
  "YouCtrl",
  "YouOwn",
  "OpponentCtrl",
  "OpponentOwn",
  // Chosen-by-player
  "ChosenPlayer",
  "ChosenColor",
  "ChosenType",
  "ChosenNumber",
  // Counters
  "CardCounters",
  "PlayerCounters",
  // Type / validity
  "TypeAmount",
  "Valid",
  "DevotionAmount",
  "MetaCount",
  // Arithmetic
  "Add",
  "Sub",
  "Mul",
  "Div",
  "Mod",
  "Min",
  "Max",
  "Negate",
  "Abs",
  // Trigger context
  "TriggerObjects",
  "TriggerPlayer",
  "TriggerCount",
  "TriggerRemembered",
  // Cost-related
  "EvokeCost",
  "FlashbackCost",
  "BuybackCost",
  "KickerCost",
]);

export const isKnownSvarSelector = (kind: string): boolean => KNOWN_SVAR_SELECTORS.has(kind);
