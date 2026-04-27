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
// Wave 38 — Channel / Transmute / Replicate / Recover / Scavenge /
// Reinforce / Strive (Retrace ships as an AltCost). Hand-zone and
// graveyard-zone activated abilities (Channel, Transmute, Reinforce,
// Scavenge), a SpellCast self-trigger (Replicate), a creature-LTB
// graveyard trigger (Recover), and a cost-tag stamp (Strive). The
// per-keyword TODO(advanced) tails close the cast-pipeline gaps.
export * from "./channel-keyword.js";
export * from "./transmute-keyword.js";
export * from "./replicate-keyword.js";
export * from "./recover-keyword.js";
export * from "./scavenge-keyword.js";
export * from "./reinforce-keyword.js";
export * from "./strive-keyword.js";
// Wave 39 — Bushido / Outlast / Provoke / Skulk / Friends Forever /
// Tempting Offer / Ripple / Sweep / Companion. Mixed combat / cast /
// activated keyword batch closing roughly 70 cards. Bushido (block-
// trigger pump), Outlast (Battlefield-zone sorcery activated), Provoke
// (attacks-trigger force-block), Ripple (SpellCast reveal), Sweep
// (SpellCast type-slot stamp). Skulk, Friends Forever, Tempting Offer,
// and Companion stamp the keyword + carry TODO(advanced) tails for the
// downstream block-restriction / deck-validation / per-opponent-confirm
// / sideboard plumbing.
export * from "./bushido-keyword.js";
export * from "./outlast-keyword.js";
export * from "./provoke-keyword.js";
export * from "./skulk-keyword.js";
export * from "./friends-forever-keyword.js";
export * from "./tempting-offer-keyword.js";
export * from "./ripple-keyword.js";
export * from "./sweep-keyword.js";
export * from "./companion-keyword.js";
// Wave 40 — Dredge (CR 702.52). Replacement effect that fires while the
// card is in the graveyard: instead of drawing, the player may mill N
// cards and return self to hand. Implemented inline in
// game-action.drawCards (decision-yielding can't fit the synchronous
// ReplacementAbility shape); the keyword handler stamps the slot.
export * from "./dredge-keyword.js";
// Wave 49 — Equip / Kicker / Multikicker / Ward. Equip synthesizes a
// Battlefield-zone sorcery-speed activated Attach SA. Kicker and
// Multikicker stamp `card.kickerCost` / `card.multikickerCost` for the
// cast pipeline's confirmAction loop in stepDetermineTotalCost. Ward
// synthesizes a BecomesTarget triggered ability that yields a pay-or-
// counter decision and counters the targeting spell on declined or
// failed payment.
export * from "./equip-keyword.js";
export * from "./kicker-keyword.js";
export * from "./ward-keyword.js";
// Wave 55 — Morph / Megamorph / Disguise (CR 702.36 / 702.94 / 702.166).
// Each handler stamps a flip-up cost slot (`card.morphCost` /
// `card.disguiseCost`) and synthesizes a Battlefield-zone activated
// SpellAbility with handlerKey "TurnFaceUp"; the synthesized SA is
// tagged with the keyword name so the TurnFaceUp resolver knows
// whether to add a +1/+1 counter (megamorph) post-flip. Disguise also
// stamps `wardCost = 2` so Wave 49's ward trigger fires while the
// card is face-down. The 3-mana face-down alt-cast for Morph is the
// cast-pipeline-level concern; Wave 55 ships the keyword data layer
// + flip-up activated ability + Adventure / Jump-Start AltCosts.
export * from "./morph-keyword.js";
export * from "./megamorph-keyword.js";
export * from "./disguise-keyword.js";
// Wave 52 — Saga (Chapter) + Class. ChapterKeywordHandler synthesizes
// the Lore-counter machinery: ETB stamp + Main1-start tick + a
// CounterAdded watcher that flips card.sagaFinalChapterResolved when
// the final chapter resolves (SBA reads this in sba/saga-class.ts).
// ClassKeywordHandler stamps card.classLevel and synthesizes a
// Battlefield-zone sorcery-speed level-up activated SA per K:Class
// line; per-level conditional triggers/statics are TODO(advanced).
export * from "./chapter-keyword.js";
export * from "./class-keyword.js";
export * from "./flag-keyword.js";
