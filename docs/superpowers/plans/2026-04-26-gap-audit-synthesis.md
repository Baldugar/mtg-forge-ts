# 🔬 Gap Audit Synthesis — What Actually Works in mtg-forge-ts

> Produced after Waves 31-45 closure. Five parallel audits cross-referenced our codebase against Forge's Java source: TODO census, effect handlers, trigger/replacement/static handlers, keyword handlers, SVar/cost/E2E corpus walk.

## 🚨 Executive summary — the "100% coverage" claim is misleading

**What "100% coverage" actually means:** every Forge `.txt` parses clean and every handler key is registered. Nothing in the scanner verifies that handlers ACTUALLY DO THE THING.

**Reality across the audits:**

| Surface | Forge has | We register | We faithfully implement | Card-impact gap |
|---|---|---|---|---|
| Effect handlers | ~199 | 158 | ~30 ✅ + ~115 🟡 + ~13 🟥 (stub) + 33 🚫 (missing) | ~hundreds |
| Trigger Modes | 110 | ~95 | ~85 ✅ + ~10 🟡 + 5 🚫 (missing) | ~60 cards |
| Replacement Events | 40 | 34 | 30 ✅ + 4 🟥 stubs + 6 🚫 (missing) | ~210 cards |
| Static Modes | ~95 | **5** | 1 🟡 (Continuous narrow) + 4 ✅ + ~90 🚫 (missing) | **~5000 cards** |
| Keyword handlers | ~135 | 56 + AltCost 12 | ~50 ✅/🟡 + ~30 🚫 (silent flag-fall-through) | **~1500+ cards** |
| Cost parts | ~30 | 6 | 4 ✅ + 2 🟡 + 24 🚫 (missing) | every PW + ~hundreds |
| SVar Count$ args | ~140 | ~13 | 13 ✅ + 0 🟡 + ~125 🚫 (missing) | ~hundreds |

**Bottom line:** the engine parses every card and synthesizes "something" for the canonical case, but functional fidelity is closer to **40-60% of unique cards play correctly end-to-end**. The remaining 40-60% have at least one silently-broken line.

## 🚨 CRITICAL fires (16 items) — actively crash live games OR break flagship cards

Sorted by blast radius:

### 1. Loyalty cost format — every planeswalker is unplayable
- **Where:** `cost-payment.ts:66/92` throws on `AddCounter<n/LOYALTY>` and `SubCounter<n/LOYALTY>` segments.
- **Impact:** Jace, Liliana, Elspeth, every PW. Walking Ballista, Spike Hatcher, every counter-cost activated ability. **Probably 100-150 cards completely dead.**
- **Fix:** Add `CostPutCounter`, `CostRemoveCounter` parts + regex routing. Uncomplicated.

### 2. Statics: `Affected$` narrowness — ~3000 cards' anthem-style statics throw
- **Where:** `static/handlers/continuous.ts:133/140` throws on every `Affected$` other than `Card.Self` / `Card.EnchantedBy`. Throws on payloads other than `AddPower / AddToughness / AddKeyword / Condition$ Threshold`.
- **Impact:** Every "Creatures you control get +X/+X", every type-changer, every set-PT (Doran), every grant-keyword to other permanents. ~3000+ corpus uses.
- **Fix:** Broaden `Affected$` filter (use Wave 32's `cardMatchesFilter`), broaden payloads (AddType, AddColor, SetPower, SetToughness, AddAbility, RemoveKeyword, CharacteristicDefining).

### 3. Equip — 586 cards silently inert
- **Where:** Falls through `FlagKeywordHandler` (just stamps "equip"); no Battlefield-zone activated `Attach` SA synthesized.
- **Impact:** **EVERY equipment in the game.** Lightning Greaves works because its static is on `Affected$ Creature.EquippedBy` (which we throw on, so even Greaves is partially broken).
- **Fix:** `EquipKeywordHandler` synthesizes activated SA from `K:Equip:N` mirroring how Forge's CardFactoryUtil L2898 does it.

### 4. Ward — 186 cards never trigger
- **Where:** `combat/keywords/ward.ts` — replacement factory exists but `matches()` is a hardcoded no-op ("SP2 scope … Milestone U deferred").
- **Impact:** Every Ward N / Ward—Pay X life card. Every premium MH3 / MOM / MKM creature. Counter-magic effectively bypasses Ward shielding.
- **Fix:** Wire the actual trigger-on-target replacement. Mirrors counter-prevention pattern.

### 5. Replacement stubs — Counter (115), Draw (34), AddCounter (30), CreateToken (28)
- **Where:** All four `matches(_intent)` return `false` unconditionally (`replacement/handlers/counter-replacement.ts:10`, `add-counter-replacement.ts:11`, `create-token-replacement.ts:10`, `draw-replacement.ts:10`).
- **Impact:** **207 cards.** Doubling Season's both halves (counters + tokens), Notion Thief, "this can't be countered" rider, Hardened Scales, Vorinclex. Backbone of competitive Magic.
- **Fix:** Add 4 MutationIntent shapes (countered, addCounter, createToken, drawCards) + wire matches().

### 6. Kicker / Multikicker — 254 cards' alternative cost path missing
- **Where:** Falls through `FlagKeywordHandler`. Cast pipeline has a comment about kicker but no actual additional-cost option.
- **Impact:** Urza's Rage, every Bant Kicker spell, every M21 Kicker card. Kicker bonus effect never fires.
- **Fix:** Wire `K:Kicker:cost` as a cast-time optional additional cost. Tie into Wave 38's `striveExtraCost` infrastructure.

### 7. Recover & Replicate — free copies bug
- **Where:** `recover-keyword.ts:95`, `replicate-keyword.ts:75` — confirmAction "pay?" is treated as paid without actually charging mana.
- **Impact:** Players get unlimited free recovery and replicates.
- **Fix:** Wire actual cost payment via `payCost` — mirror Cumulative Upkeep's mana-loop.

### 8. Cost-system throws beyond loyalty
- **Where:** `cost-payment.ts:66/92` — `Q` (untap), all unrecognized prefixes throw.
- **Impact:** Pemmin's Aura, Quirion Ranger, every untap-cost card. Cost-prefix forms `ExileFromGrave<n/Filter>` (general), `PayEnergy<n>`, `Mill<n>`, `Draw<n/who>`, `Damage<n>`, `Reveal<...>`, `Return<...>`, `tapXType<...>` all silent-throw at parse.
- **Fix:** Unified cost-parts wave covering 8-10 missing CostPart subclasses.

### 9. Wave-22 effect no-ops (~7 effects, ~50 cards)
- **Where:** `wave-22-effects.ts:519+` — `RestartGame`, `Endure`, `Learn`, `ReorderZone`, `OpenAttraction`, `MultiplePiles`, `VillainousChoice` — all pure `void sa; void game;` no-ops.
- **Impact:** Karn -14 ult does nothing. Every Endure card (Bloomburrow ranger family) does nothing. Every Learn card (Strixhaven Lessons family, 21+ cards) does nothing. Ravnica Allegiance Attractions / Unfinity coin flips silently skip.
- **Fix:** Wire each. Most have a clear MVP path (Learn = tutor lesson + discard + draw).

### 10. Phases — toggles flag but no engine reads it
- **Where:** `wave-18-effects.ts:phases` toggles `card.phasedOut` but nothing in combat / board iteration / target selection consults it.
- **Impact:** Teferi's Veil, Tawnos's Coffin, every phasing-out effect: card "phases out" but still attacks, blocks, takes damage, etc.
- **Fix:** Add `isPhasedOut` filter in combat declaration + target enumeration + SBA destroy collector.

### 11. Clone doesn't actually copy
- **Where:** `wave-18-effects.ts:CloneEffect` only stamps `remembered`. No Layer 1 copy effect emitted.
- **Impact:** Phantasmal Image, Clone, Phyrexian Metamorph, Quasiduplicate target's copy, every clone card. Non-functional.
- **Fix:** Emit a Layer 1 copy effect with `copyTarget` characteristics; tie into existing `copy/copiable-characteristics.ts`.

### 12. Saga (Chapter triggers) — every Saga is dead text
- **Where:** Parser emits opaque `chapter` keyword id; no chapter-trigger scaffolding.
- **Impact:** History of Benalia, every Dominaria/Theros Saga (~80 cards). Sagas appear on the battlefield but their text never executes.
- **Fix:** `K:Chapter:N:DB1,DB2,...` keyword handler that installs upkeep lore-counter trigger + per-chapter SVar resolution.

### 13. Class — every Class card never levels up
- **Where:** Parser emits opaque `class` keyword id; no level-up SA + per-level grants.
- **Impact:** AFR/SNC Class enchantments — Ranger Class, Cleric Class, etc. (~25 cards).
- **Fix:** `K:Class:level:cost:AddTrigger$/AddStaticAbility$` keyword handler synthesizes activated SAs + level-gated grants.

### 14. Morph / Megamorph / Disguise (~184 cards)
- **Where:** Face-down infrastructure exists but flip-up activated SA cost not synthesized for Morph/Megamorph/Disguise; Disguise's Ward2 layer absent.
- **Impact:** Khans of Tarkir Morph cycle, Time Spiral Manifests, MH3 Disguise.
- **Fix:** Add Morph alt-cast (face-down 2/2 for {3}) + flip-up activated cost reading the morph cost.

### 15. SVar conditional ternaries — ~100+ flagship cards
- **Where:** Forge form `Count$<Flag>.<elseVal>.<thenVal>` (Hellbent, Metalcraft, Threshold, Kicked, Foretold, FatefulHour, Revolt, Landfall, Monarch, Adamant, Bargain, etc.) has no dispatcher in our `count.ts`.
- **Impact:** Anything whose X scales with a state-flag. Urza's Rage's "Kicked $.0.4" form falls through. Many flagships completely break.
- **Fix:** Add a single conditional-ternary dispatcher in `selectors/conditions.ts`. Read each flag from the player / game state.

### 16. `Count$CardCounters_<Type>` / `Count$CardPower` / `Count$CardSumPT`
- **Where:** Source-card probes — completely missing.
- **Impact:** Smokestack always sacrifices 0. Niv-Mizzet variants, Spike Hatcher, every "X equals counters on me" card silently 0s.
- **Fix:** Tiny selectors reading `card.counters.get(<Type>)` and `chars.power/toughness`.

## 🟡 IMPORTANT gaps (rare cards but real)

The audit identified ~95 IMPORTANT gaps; the bulk fall into these archetypes:

### A. Static modes missing (the deepest gap by card count)
~90 modes Forge has, 4 we have. Top by corpus frequency:
- **CantBlockBy** (350 cards) — Fear/Intimidate/Skulk/Menace-as-static
- **CantAttack** (199) — Propaganda
- **AlternativeCost** (146) — Awaken/Surge static
- **CantBlock** (137) — "X can't block"
- **CantBeCast** (99) — Conqueror's Flail / Meddling Mage
- **MustAttack** (97) — Goad-style + Propaganda inverse
- **CastWithFlash** (51) — Vedalken Orrery / Leyline of Anticipation
- **MinMaxBlocker** (42) — "must be blocked by exactly N"
- **OptionalCost** (38) — additional optional costs
- **Panharmonicon** (33) — trigger-doubler family
- **CantBeActivated** (32) — Linvala / Pithing Needle
- **CanAttackDefender** (30) — defender-attacker
- **CantTarget** (27) — Hexproof-static
- **CombatDamageToughness** (19) — Doran-style
- **AssignCombatDamageAsUnblocked** (13) — trample-as-unblocked
- ~75 more modes at 1-15 cards each

### B. Effect MVP gaps
The biggest are:
- **ChangeZone** (4199 corpus uses, our impl 47 LoC vs Forge 1699 LoC): missing Origin$ filter, Hidden$, ChangeNum$, Imprint$, Chooser$, AtRandom$, Reveal$, Tapped$, Attacking$, WithCounters$ — fetchlands/tutors/recursion all under-served.
- **DealDamage** (~2745 uses): missing DamageMap$, RememberDamaged$, divided-damage strict mode, Defined$, RelativeTarget$.
- **PutCounter** (2313): missing UpTo$, EachExistingCounter$, EachValid$, DividedAsYouChoose$, distributed-amount.
- **Pump** (5352 across pump variants): KW$ partial; advanced "until permanent leaves" / IsCurse$ missing.
- **Token** (3366): RememberTokens$ partial, MultipliesEnchant$ missing.
- **Effect** (1812): RememberObjects$ + post-resolve cleanup partial; some sub-handlers wired, others not.
- **Mana** (2388): Restrict$, Replace$ Pool, X-eval missing.
- **Discard** (1055): random vs targeted vs RevealDiscardAll modes incomplete.
- **Counter** counterspell (520): DestinationZone$ Exile/Hand/Library missing.
- **Sacrifice** (858): Amount$ X, Mandatory$, RememberSacrificed$ missing.
- **CopyPermanent** (340): AddTriggers$, AddTypes$, Embalm$ subset missing.
- **Animate** (921): Until$ MyNextTurn, RememberObjects$, scripted P/T, Hidden$ set missing.
- **GainControl** (320): LoseControl$ Until granular missing — temporary control becomes permanent.

### C. Effect missing entirely
- **ReplaceEffect family** (~300 corpus uses): ReplaceEffect, ReplaceDamage, ReplaceMana, ReplaceToken, ReplaceCounter, ReplaceSplitDamage. None registered.
- **Mutate / Encode / ClassLevelUp** as effect dispatchers: missing despite keyword handlers existing.
- **Cloak** (11), **Heist** (8), **Intensify** (18), **Radiation** (22), **Abandon** (21), **DrainMana** (5), **Planeswalk** (28), **DamageResolve** (63), **ChangeZoneResolve**, **ChaosEnsues** (9): all missing.

### D. Keywords falling through to FlagKeyword (~30 keywords silent-broken)
Top: **Equip** (586), **Kicker** (236), **Ward** (186), **Morph** (153), **Affinity** (74), **Prowess** (82), **Unearth** (57), **Disguise** (47), **Buyback** (40), **Encore** (26), **Backup** (26), **Cipher** (15), **Reconfigure** (21), **Spree** (21), **Prototype** (21), **Annihilator** (14), **Battle cry** (13), **Exalted** (34), **Extort** (17), **Bloodthirst** (23), **Casualty** (16), **Class** (35 chapters via L2768/3853), **Saga/Chapter** (~80 sagas).

### E. SVar selectors missing (~125)
Per-turn / per-game stat trackers (`YouDrewThisTurn`, `LifeYouLostThisTurn`, etc.), source-card probes, mana-payment provenance (`xColorPaid`, `EachSpentToCast`), state flags (Hellbent, Metalcraft, etc.), majority queries (MostCardName, MostProminentCreatureType), `LastStateBattlefield`, `Party`, `Chroma`, `UrzaLands`, etc.

### F. Trigger Modes missing
- **DamageDealtOnce** (47 cards) — distinct from DamageDoneOnce
- **ClassLevelGained** (every Class card)
- **Adapt** (~10 RNA cards)
- **TakesInitiative**, **RoomEntered** (niche)

### G. Replacement Events missing
- **AssignDealDamage**, **DealtDamage**, **DeclareBlocker**, **PlanarDiceResult**, **SetInMotion**, **Tap** — lower-frequency but real.

### H. Cost parts missing
- **CostPutCounter / CostRemoveCounter** (loyalty + counter activations) — CRITICAL above
- **CostExile** zones beyond self-from-graveyard
- **CostPayEnergy** (Kaladesh / ONE)
- **CostMill**, **CostFlipCoin**, **CostRollDice**
- **CostDamage** (DamageYou<n>)
- **CostDraw** (Smuggler's Copter)
- **CostReveal**, **CostReturn**, **CostUnattach**
- **CostExert**, **CostEnlist**, **CostCollectEvidence** (set-specific)
- **CostUntap** ("Q") — currently throws
- **CostTapType / CostUntapType** — tap-N-of-type costs

### I. Decision schema gaps (~25 effects affected)
Many effects auto-pick "first eligible" instead of yielding chooseCard / chooseCards / chooseEvenOdd / chooseRingBearer / chooseSector / chooseDirection / chooseLearnOption / chooseEndureOption / dividePileChoice / orderCards / discard chooser. Bundle as a single "decision request kinds" wave.

## ✅ What actually works well

To give credit:
- **Combat** is solid: damage assignment, deathtouch, first/double strike, trample-over-PW, lifelink, blocker legality (excluding evasion-grant-as-static).
- **Mana solver**: full color-aware solver with hybrid + phyrexian + X.
- **Cast pipeline**: 10-step generator with alt-cost integration (Flashback, Madness, Foretell, Bestow, Overload, Plot, Suspend, Disturb, Mutate, Aftermath, Splice, Retrace).
- **Layer engine**: CR 613 layered characteristic derivation, Layer 6 keyword grants (Wave 32).
- **Trigger framework**: 95+ Modes with correct event matching.
- **Token database**: 36+ entries with TokenScript$ + activated abilities.
- **AltCostRegistry**: 12 alt-costs.
- **The 50+ keyword handlers we DO have**: Cycling, Flashback, Madness, Foretell, Bestow, Overload, Cascade, Plot, Specialize, Convoke (with color-pip), Improvise, Crew, Saddle, Mutate, Suspend, Conspire, Champion, Echo, Cumulative Upkeep, Day/Night, Initiative, Monarch, Evolve, Station, VisitAttraction, Forage, Adapt, Renown, Mentor, Disturb, Storm, Ninjutsu, Graft, Modular, Living Weapon, Riot, Rebound, Persist, Undying, Vanishing, Fading, Devour, Soulshift, Soulbond, Splice, Hideaway, Sunburst, Channel, Transmute, Replicate, Recover, Retrace, Scavenge, Reinforce, Strive, Bushido, Outlast, Provoke, Skulk, Friends Forever, Tempting Offer, Ripple, Sweep, Companion, Dredge, Embalm, Eternalize.
- **Snapshot v7**: round-trips 35+ transient slots.
- **Wave 32-42 closures**: IsPresent$/PresentCompare$, comma-OR ValidCard$, Threshold static condition, Layer 6 keyword grants, SVar selector pack.

## 🎯 Recommended fix waves (prioritized by leverage)

### Wave 46 — Cost system completion (HIGHEST LEVERAGE)
Single wave unblocks **every planeswalker** + ~hundreds of activated abilities. Add:
- `CostPutCounter` / `CostRemoveCounter` (loyalty + counter activations)
- Generalized `CostExile<n/Filter>` (zone-aware)
- `CostPayEnergy<n>`, `CostMill<n>`, `CostDraw<n/who>`, `CostDamage<n>`, `CostReveal`, `CostReturn`
- `CostUntap` ("Q") — currently throws
- `CostTapType / CostUntapType` filter forms

### Wave 47 — Continuous static broadening
Single file change unblocks ~3000 cards. In `static/handlers/continuous.ts`:
- Replace `Affected$ Card.Self / Card.EnchantedBy` exclusivity with full `cardMatchesFilter` from Wave 32.
- Add payloads: `AddType$`, `AddColor$`, `SetPower$`, `SetToughness$`, `AddAbility$`, `RemoveKeyword$`, `RemoveCardTypes$`, `CharacteristicDefining$`, `MayLookAt$`.
- Add live evaluators for the 8 named conditions (Hellbent, Metalcraft, Delirium, FatefulHour, Landfall, Heroic, Revolt, Spellmastery).

### Wave 48 — Replacement intent kinds + 4 stub fixes
Add 4 MutationIntent shapes to `replacements/mutation-intent.ts`:
- `countered` (intent.kind="countered") — wire CounterReplacement.matches()
- `addCounter` — already exists; wire AddCounterReplacement.matches() to actually fire
- `createToken` — wire CreateTokenReplacement.matches()
- `drawCards` — wire DrawReplacement.matches()
Plus add the 6 missing replacement events: AssignDealDamage, DealtDamage, DeclareBlocker, PlanarDiceResult, SetInMotion, Tap.

### Wave 49 — Equip + Kicker + Ward
Three highest-card-count silently-broken keywords (~1008 cards).
- `EquipKeywordHandler` synthesizing battlefield-zone activated Attach SA from `K:Equip:N`.
- `KickerKeywordHandler` wiring optional additional cost on cast (mirror Wave 38's strive infrastructure).
- Fix `combat/keywords/ward.ts` — wire the "becomes targeted" replacement that adds the additional cost.

### Wave 50 — Static mode pack (the long tail)
~90 missing static modes. Top 10 by card count = ~1700 cards. One handler per mode is small (~30 LoC each); the leverage is in the layer/combat-handler integrations.
- CantBlockBy, CantAttack, CantBlock, MustAttack
- CantBeCast, CantBeActivated, CantTarget, CastWithFlash
- AlternativeCost, OptionalCost, Panharmonicon, MinMaxBlocker
- CombatDamageToughness, CanAttackDefender, AssignCombatDamageAsUnblocked

### Wave 51 — SVar conditional ternary + selector long-tail
- `Count$<Flag>.<else>.<then>` ternary dispatcher (10 named flags) — ~100+ cards
- Source-card probes (`Count$CardCounters_<T>`, `Count$CardPower`, `Count$CardToughness`, `Count$CardSumPT`, `Count$CardNumColors`, `Count$CrewSize`)
- Per-turn / per-game stat selectors (~30 Count$ args)
- Mana-payment provenance (`xColorPaid`, `EachSpentToCast`)
- Compound: `Count$Valid <A>,<B>` (comma-OR multi-filter)

### Wave 52 — Saga + Class + Chapter scaffolding
- `K:Chapter:N:DB1,DB2,DB3` upkeep lore-counter trigger + per-chapter resolve.
- `K:Class:level:cost:AddTrigger$/AddStaticAbility$` activated level-up SA + per-level grants.
- ~105 cards (80 Sagas + 25 Class).

### Wave 53 — Effect MVP→full upgrades (the slow grind)
Touch ~30 effects to add the missing Forge params:
- ChangeZone advanced params (Origin$ filter, Hidden$, Imprint$, Chooser$, Reveal$)
- DealDamage DividedAsYouChoose strict, DamageMap$, RememberDamaged$
- PutCounter UpTo$, EachExistingCounter$, EachValid$, DividedAsYouChoose$
- Pump KW$ full grammar
- Counter spell DestinationZone$
- Sacrifice Amount$ X
- CopyPermanent AddTriggers$/AddTypes$
- Animate Until$ MyNextTurn / RememberObjects$
- Mana Restrict$ / Replace$ Pool
- Discard random vs targeted modes
- Effect RememberObjects$ post-resolve cleanup
- GainControl LoseControl$ Until granular

### Wave 54 — Phasing + Clone + Wave-22 effect no-ops
- Phasing: filter `card.phasedOut` in combat declaration + target enumeration + SBA destroy collector.
- Clone: emit Layer 1 copy effect with copyTarget characteristics.
- Wave-22 no-ops: Endure, Learn, RestartGame, ReorderZone, OpenAttraction, MultiplePiles, VillainousChoice (each ~30-50 LoC).

### Wave 55 — Morph/Megamorph/Disguise + Adventure + Jump-Start
- Morph alt-cast (face-down 2/2 for {3}) + flip-up activated cost.
- Megamorph adds +1/+1 counter on flip-up.
- Disguise = Morph + Ward 2.
- Adventure: cast-from-Adventure-half + exile-after-resolve.
- Jump-Start: cast-from-graveyard with discard cost (similar to Flashback shape).

### Wave 56 — ReplaceEffect family + DamageResolve + Decision schema gaps
- `DB$ ReplaceEffect` + ReplaceDamage / ReplaceMana / ReplaceToken / ReplaceCounter / ReplaceSplitDamage handlers (used inside replacement triggers' bodies).
- Decision request kinds: chooseCards (interactive), chooseEvenOdd, chooseRingBearer, chooseSector, chooseDirection, chooseLearnOption, dividePileChoice, orderCards.
- Wave-21 effects' MVP simplifications get promoted.

### Wave 57+ — Niche keyword cleanup + remaining long-tail
- Annihilator, Battle cry, Exalted, Prowess, Extort, Melee, Miracle, Surge, Emerge, Fabricate, Bloodthirst, Amplify, Cipher, Buyback, Awaken, Casualty, Backup, Squad, Encore, Escalate, Prototype, Reconfigure, Impending, Warp, Tribute, Dethrone, Sneak, Transfigure, Double team, Enlist, Spree, Spectacle, Freerunning, Blitz, Living metal, Demonstrate, Mobilize, Offspring, Ravenous, Read ahead, Web-slinging, Firebending, More Than Meets the Eye, For Mirrodin, Job select.

## 📋 Files most likely to need touching

Cost system:
- `packages/game/src/cost/parts/cost-payment.ts` (regex routing)
- `packages/game/src/cost/parts/` (new files for each CostPart)

Static handler:
- `packages/game/src/static/handlers/continuous.ts` (broaden)
- `packages/game/src/static/handlers/` (new files for each missing mode)

Replacement system:
- `packages/game/src/replacement/handlers/{counter,add-counter,create-token,draw}-replacement.ts` (un-stub matches())
- `packages/game/src/replacements/mutation-intent.ts` (add 4+ intent kinds)

Keyword handlers:
- `packages/game/src/keyword/handlers/` (Equip, Kicker, Saga/Chapter, Class, Morph)
- `packages/game/src/combat/keywords/ward.ts` (un-stub)

SVar:
- `packages/game/src/svar/selectors/conditions.ts` (NEW)
- `packages/game/src/svar/selectors/card-state.ts` (NEW)
- `packages/game/src/svar/selectors/turn-state.ts` (NEW)

Effects:
- `packages/game/src/ability/effects/wave-22-effects.ts` (un-stub no-ops)
- `packages/game/src/ability/effects/clone.ts` (or wave-18-effects.ts)
- `packages/game/src/ability/effects/phases.ts` (or wave-18-effects.ts)
- ~30 effect files for MVP→full upgrades

## 📊 Final card-impact estimate

If we close all 16 CRITICAL + Wave 46-50 (top-priority follow-ups):
- **Cards unlocked**: ~5,000+ (out of 32,300)
- **From silently-broken to actually-playing**: ~15-20% of corpus
- **Brings functional fidelity from ~50% to ~75-80% of unique cards**

Remaining IMPORTANT/MINOR work: another ~5,000-7,000 cards, dispersed across smaller waves.

## 🎯 The "100% port" reality check

The corpus is 100% parsed. Every handlerKey is registered. **Functional fidelity is closer to ~50% of cards working end-to-end.** That's still a substantial achievement — the engine is structurally complete, all the scaffolding exists, and ~50% of cards Just Work. But the user's "100% port no defers" mandate hasn't been met in functional terms.

The audits identified 16 CRITICAL items + 95 IMPORTANT items + ~99 MINOR items. Closing the CRITICAL items + first 5 follow-up waves (46-50) realistically brings us to ~75-80%. Closing everything brings us to 95%+.

This is a multi-month finishing job. The plans are clear; the work is mechanical for most items.
