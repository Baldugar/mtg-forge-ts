// SPDX-License-Identifier: GPL-3.0-or-later
// Bootstrap — importing this file registers all concrete KeywordHandler
// subclasses with keywordHandlerRegistry. Export * ensures bundlers include
// the module-level register() side effects even when tree-shaking.
//
// ORDER MATTERS: specific handlers must be imported BEFORE the fallback
// ("*") FlagKeywordHandler so they take precedence in the registry map.
// The registry stores specific handlers in byKeyword and the fallback
// separately — lookup always prefers byKeyword over fallback — so order is
// actually irrelevant at runtime, but listing specifics first is cleaner.
export * from "./cascade-keyword.js";
export * from "./convoke-keyword.js";
export * from "./crew-keyword.js";
export * from "./cycling-keyword.js";
export * from "./improvise-keyword.js";
export * from "./saddle-keyword.js";
export * from "./specialize-keyword.js";
export * from "./plot-keyword.js";
export * from "./suspend-keyword.js";
export * from "./conspire-keyword.js";
export * from "./champion-keyword.js";
export * from "./echo-keyword.js";
export * from "./cumulative-upkeep-keyword.js";
export * from "./mutate-keyword.js";
export * from "./evolve-keyword.js";
export * from "./station-keyword.js";
// Wave 29 — Adapt / Renown / Mentor (Daybound, Nightbound, Disturb are
// flag/altcost shaped; Daybound and Nightbound fall through to FlagKeyword
// and are auto-flipped from day-night-tracker, while Disturb is registered
// as an AltCost rather than a keyword handler).
export * from "./adapt-keyword.js";
export * from "./renown-keyword.js";
export * from "./mentor-keyword.js";
// Wave 30 — Storm / Ninjutsu / Graft / Modular / Living Weapon / Riot /
// Rebound. Each is a self-contained keyword handler that registers ETB,
// LTB, SpellCast, or upkeep triggers + (for Ninjutsu) a synthesized
// activated SpellAbility.
export * from "./storm-keyword.js";
export * from "./ninjutsu-keyword.js";
export * from "./graft-keyword.js";
export * from "./modular-keyword.js";
export * from "./living-weapon-keyword.js";
export * from "./riot-keyword.js";
export * from "./rebound-keyword.js";
// Wave 31 — Persist / Undying. Death-trigger handlers (Battlefield →
// Graveyard); on resolve, conditionally return the dying card with a
// counter (M1M1 for Persist, P1P1 for Undying).
export * from "./persist-keyword.js";
export * from "./undying-keyword.js";
// Wave 33 — Embalm / Eternalize. Synthesize a Graveyard-zone activated
// SpellAbility that pays mana + ExileFromGrave<self> to spawn a token copy
// with colour / type / P-T / no-mana-cost overrides applied via the
// tokenOverrides slot consumed by deriveBaseCharacteristics.
export * from "./embalm-keyword.js";
export * from "./eternalize-keyword.js";
// Wave 35 — Vanishing / Fading. Countdown-on-upkeep mechanics; ETB stamps
// Time/Fade counters, upkeep trigger removes one and sacrifices on
// last-removed (Vanishing) or can't-remove (Fading). K:Phasing already
// works via FlagKeywordHandler since the phasing pipeline is wired in
// processPhasingOnUntap.
export * from "./vanishing-keyword.js";
export * from "./fading-keyword.js";
// Wave 37 — Devour / Soulshift / Soulbond / Splice / Hideaway / Sunburst.
// Six small mechanics, mostly ETB triggers (Devour, Soulbond, Hideaway,
// Sunburst) + a death trigger (Soulshift) + a hand-side AltCost stamp
// (Splice). Splice and Hideaway carry TODO(advanced) tails for the
// in-flight spell-graft / conditional free-cast paths.
export * from "./devour-keyword.js";
export * from "./soulshift-keyword.js";
export * from "./soulbond-keyword.js";
export * from "./splice-keyword.js";
export * from "./hideaway-keyword.js";
export * from "./sunburst-keyword.js";
export * from "./flag-keyword.js";
