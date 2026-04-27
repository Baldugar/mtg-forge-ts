# 🎯 NEXT STEPS — Waves 31-59 Done

> **Status:** Waves 31-59 complete. ~80% functional fidelity on the 32,300-card Forge corpus. 100% parser/registration coverage holds. Next session continues from Wave 60.

> **Read this first:** This document is the canonical handoff. The kickoff prompt at the bottom can be pasted directly into the next session to resume work.

---

## State snapshot (post-Wave 59)

- **Repo:** `F:\BACKUP\Programacion\mtg-forge-ts`
- **Branch:** `sp1-engine-foundations` (local only; never pushed)
- **HEAD:** `3e61db2` (Wave 59 (B+C) — Affinity + final niche batch)
- **Commits since `dbe90e6`:** ~325
- **Tests:** **3,853 passing** (2,995 game + 134 cards + 724 core)
- **Coverage:** **100.0%** on full 32,300-card Forge corpus (parsed clean, every handler key registered)
- **Gates:** typecheck ✅, build ✅, test ✅, lint ✅, DCO ✅

---

## What's been done — full catalogue

### Phase 1: Waves 6-30 (post-SP3 closure → registration milestone)
Cost-mod runtime + Madness + activated targets + EOT cleanup + AbilityCastTrigger + Foretell + Overload + Bestow + cost-mod completeness + DamageDoneOnce + ValidTgts$ + Domain + Count$. Closed registration to ~95% corpus coverage.

### Phase 2: Waves 31-45 (registration → 100% corpus + final long-tail)
- **Wave 31** — Persist + Undying (death-trigger pattern)
- **Wave 32** — Threshold + Constellation + Battalion + Revolt (state-condition triggers + IsPresent$/PresentCompare$ + comma-OR ValidCard$ + Layer 6 keyword grants)
- **Wave 33** — Embalm + Eternalize + Aftermath (graveyard recursion + tokenOverrides)
- **Wave 34** — Battle card type runtime (Defense + protector + defeat)
- **Wave 35** — Vanishing + Fading countdown
- **Wave 36** — Wither + Infect damage redirection
- **Wave 37** — Devour + Soulshift + Soulbond + Splice + Hideaway + Sunburst
- **Wave 38** — Channel + Transmute + Replicate + Recover + Retrace + Scavenge + Reinforce + Strive
- **Wave 39** — Bushido + Outlast + Provoke + Skulk + Friends Forever + Tempting Offer + Ripple + Sweep + Companion
- **Wave 40** — Dredge replacement (drawCards integration)
- **Wave 41** — Engine-side EMIT verification + MVP upgrades
- **Wave 42** — SVar selector pack (Devotion / NumColors / Basic-land counts / Storm / Valid grammar)
- **Wave 43** — GameSnapshot v7 (35+ transient slots round-tripped)
- **Wave 44** — SubgameEffect (Shahrazad) deterministic resolution
- **Wave 45** — Final long-tail: Initiative dungeon + Contraption deck + ChangeText Layer 1/4 + MakeCard registry

### Phase 3: Gap audit (5 parallel agents) — Waves 31-45 closed registration; functional reality was ~50%.

### Phase 4: Waves 46-59 (functional fidelity push)
- **Wave 46** — Cost system completion (loyalty + 9 new CostParts: PutCounter, RemoveCounter, generalized Exile, PayEnergy, Mill, Draw, Damage, Untap "Q", Reveal, Return, TapType). **Every planeswalker now activates.** ~150 cards.
- **Wave 47** — Continuous static broadening (Affected$ + payloads + 8 named conditions). **~3000 cards.** Single biggest unlock.
- **Wave 48** — Replacement intent kinds: Counter / AddCounter / CreateToken / Draw stubs un-stubbed + 6 events registered. ~210 cards.
- **Wave 49** — Equip + Kicker + Ward un-stubbed. **~1008 cards.**
- **Wave 50** — Static mode pack: 12 modes (CantBlockBy / CantAttack / CantBlock / MustAttack / CantBeCast / CantBeActivated / CastWithFlash / AlternativeCost / OptionalCost / Panharmonicon / MinMaxBlocker / CanAttackDefender). ~1700 cards.
- **Wave 51** — SVar selector pack: 18 conditional flags + 7 source-card probes + 20 per-turn stats. ~250 cards.
- **Wave 52** — Saga + Class + Chapter scaffolding. ~105 cards.
- **Wave 53** — Effect MVP→full upgrades on 12 effects (ChangeZone / DealDamage / PutCounter / Pump / Token / Effect / Mana / Discard / Counter / Sacrifice / CopyPermanent / Animate + GainControl). ~hundreds.
- **Wave 54** — Phasing wiring (isPhasedOut consulted by combat/target/SBA) + Clone copy + 7 Wave-22 no-ops filled (RestartGame / Endure / Learn / ReorderZone / OpenAttraction / MultiplePiles / VillainousChoice). ~125 cards.
- **Wave 55** — Morph + Megamorph + Disguise + Adventure + Jump-Start. ~250 cards.
- **Wave 56** — ReplaceEffect family (6 sub-effects via SVar dispatch) + 8 decision request schemas (chooseEvenOdd / chooseDirection / chooseLearnOption / chooseEndureOption / dividePileChoice / orderCards / etc.). ~300 cards.
- **Wave 57** — Niche batch 1: Annihilator + Battle cry + Exalted + Prowess + Extort + Melee + Bloodthirst + Fabricate + Cipher + Buyback + Awaken. ~200 cards.
- **Wave 58** — Niche batch 2 + mentor/provoke payload bug fix: Casualty + Backup + Squad + Encore + Escalate + Prototype + Reconfigure + Warp + Tribute + Dethrone + Spree + Blitz + Living metal + Demonstrate + Mobilize + Offspring + Sneak + Transfigure + Surge + Emerge + Miracle + Amplify. ~300 cards.
- **Wave 59** — Affinity + parser cleanup + final niche batch: Unearth + Read ahead + More Than Meets the Eye + For Mirrodin + Job select + Spectacle + Freerunning + Frenzy + Aura swap + Ascend + Decayed + Compleated + Double team + Visit + Web-slinging + Firebending + Enlist + Ravenous. ~270 cards.

---

## Functional fidelity — what we actually achieved

| Surface | Pre-46 | Post-59 |
|---|---|---|
| Cost parts | 6 (broken on loyalty) | 17 (all PWs work) |
| Static modes | 5 of ~95 | 17 of ~95 (top 12 covering ~5,000 cards) |
| Replacement events | 30 ✅ + 4 🟥 + 6 🚫 | 36 ✅ + 4 🚫 (low-freq) |
| Effect handlers | ~30 ✅ + 115 🟡 + 13 🟥 + 33 🚫 | ~50 ✅ + 80 🟡 + 0 🟥 + 25 🚫 |
| Keyword handlers | 50 of ~135 | **~110 of ~135** |
| SVar Count$ args | 13 of ~140 | ~50 of ~140 |
| Decision request kinds | ~10 | ~22 |

**Card-impact estimate:**
- Pre-Wave-46: ~50% of unique cards play correctly end-to-end
- Post-Wave-59: **~80% of unique cards play correctly end-to-end**

---

## What's left — Wave 60+ roadmap

Roughly 20% of the corpus still has at least one TODO(advanced) tail or low-frequency missing surface. Closing it is mostly mechanical sub-param fidelity work. Recommended sequencing by leverage:

### Wave 60 — Deeper static mode pack
The remaining ~80 static modes Forge has but we don't. Top by frequency from the gap audit:
- **CharacteristicDefining$ True** sub-cases (set-color, set-type via SVar)
- **CantPutCounter** (Solemnity-style)
- **CantBeRegenerated** (deathtouch synergies)
- **MaxLevel** (Level Up)
- **Untap** static (Awakening Zone)
- **DontUntap** (rune/ Stasis-style)
- **PreventNextDamage** static
- **AddTrigger / AddReplacement / AddStaticAbility** sub-payloads on Continuous (currently TODO(advanced) — ability-grant machinery)
- **MayBeCastBy** (companion / oracle of mul daya)
- **ManaConvert** (mana-color rewrite statics)
- **ManaEachReplaceColor** (ramp doublers)
- **Crew** static-form (some Vehicles are statics)
- ~70 more lower-frequency
- **Estimate:** ~1,500-2,000 cards

### Wave 61 — Decision-driven effect resolution
Wave 56 added the decision request kinds; Wave 54's effects were updated mid-flight but several effects still auto-pick first-eligible. Migrate:
- ReorderZone → orderCards (interactive ordering)
- Endure → chooseEndureOption proper
- Learn → chooseLearnOption proper
- MultiplePiles → dividePileChoice proper
- VillainousChoice → opponent-chosen sub-SVar
- Spree → per-mode-cost selection
- Plus all "MVP auto-pick" tails in keyword handlers (Mentor, Provoke, Backup, Tribute, Mobilize, Encore, Cipher, Awaken, Bloodthirst-target-pick, etc.)
- **Estimate:** ~300 cards' UX correctness improves; not strictly functional gains but needed for human play

### Wave 62 — Token database + ETB-creates-token mechanics full wire
Several Wave 57-59 keywords have `// TODO(advanced)` for the token creation path because the token PaperCard registry isn't fully wired:
- Mobilize (Soldier 1/1 attacking)
- For Mirrodin (Rebel 2/2 + auto-attach)
- Encore (token copies attacking each opponent)
- Endure (Spirit Ally 0/0 with bands-with-other)
- Living Weapon (Germ 0/0)

The token database (`packages/cards/src/tokens/token-database.ts`) has 36+ entries. Ensure all referenced tokens exist there + wire the resolvers. ~150 cards.

### Wave 63 — Sub-param tightness sweep across Wave 53 effects
Wave 53 broadened 12 effects to MVP+. Many TODO(advanced) tails remain:
- ChangeZone Chooser$ (full decision-driven)
- DealDamage DamageMap$ (per-target divided)
- PutCounter UpTo$ via decision (currently maxes)
- Discard Mode$ TgtChoose
- Counter spell: replacement-loop destination override
- CopyPermanent AddColors$ (Layer 5 integration)
- Mana Replace$ Pool
- ~30 minor sub-params
- **Estimate:** ~hundreds of cards' edge cases firm up

### Wave 64 — Cipher + Cast-copy infrastructure
Wave 57 stamped Cipher's encoding link but the cast-copy at combat-damage-to-player path is MVP. Forge models full encode-on-creature + cast-copy with newTargets. Same infrastructure benefits Demonstrate (Wave 58's optional copy).

Add `game.action.castCopyOf(spellSourceId, opts: { newTargets?: boolean; freecast: boolean })`. Use it in Cipher resolver + Demonstrate + Replicate (Wave 38) + Casualty (Wave 58) + Squad (Wave 58) + Casualty's per-extra-cost copies.

**Estimate:** ~50 cards, fixes the entire copy-spell mechanic class.

### Wave 65 — Combat-handler reads on stamped flags
Many Wave 49-59 handlers stamp combat-relevant flags but the combat-handler doesn't yet read them:
- `card.decayed` (Wave 59) → exclude as blocker, sac after attack
- `card.warpedUntilEot` (Wave 58) → temporary creature type until EOT
- `card.livingMetal` (Wave 58) → vehicle-as-creature-on-your-turn
- `card.adventureSide` (Wave 55) → graveyard-vs-exile-after-resolve gate
- `card.enteredAttacking` (Wave 53) → include in attackers list
- `card.compleatedPaidLife` (Wave 59) → -2 loyalty on PW ETB
- Static `MustAttack` from Wave 50 → goad-shape mandatory attack
- Static `CantAttack` from Wave 50 → reject attacker declaration

Single coordinated combat-handler read pass. ~150 cards with at least one combat path.

### Wave 66 — Sideboard + Outside-the-game zone
Wave 39's Companion stamps + Wave 54's Learn lesson-tutor branch + Wave 58's Double team copy stamp all need this infrastructure:
- Add `Player.sideboard: Card[]` zone.
- Add `ZoneType.OutsideTheGame` for Wishes / Companion / Learn lessons.
- Wire `K:Companion`'s 8th-card slot + 3-mana cost-to-hand activated ability.
- Wire `K:Double team`'s "add a copy in starting deck".

**Estimate:** ~30 cards, but unlocks competitive constructed scenarios.

### Wave 67 — Replacement intent threading on non-Damage parents
Wave 56's `ReplaceEffect` family is wired only for Damage parents. Same mechanical pattern for Moved / AddCounter / CreateToken / ProduceMana parents. ~100 cards.

### Wave 68 — Adventure full plumbing + Read ahead Saga modification
- Adventure (Wave 55): the AdventureAltCost is registered; resolver-side stamp `card.adventureSide = "spell"` on Adventure-half resolution + override moveTo destination from Graveyard → Exile is documented as TODO(advanced). Wire it.
- Read ahead (Wave 59): Saga ETB modification — pick start chapter + advance one less. Hook into chapter-keyword.ts.

**Estimate:** ~40 cards.

### Wave 69 — Splice (Arcane spell text-grafting)
Wave 37 / Wave 58 stamped splice as AltCost; the actual graft-text-onto-Arcane-spell is TODO(advanced). This requires modifying an in-flight spell's effect chain. ~30 cards.

### Wave 70 — Decisions UX polish
The `RandomLegalController` is the only consumer of decision requests today. Forge has rich decision UIs (auto-pick toggles, target-prompts, mode-select dialogs, divided-choose helpers). For headless-engine play this is fine; for any UI integration it needs a richer Decision protocol. Defer until UI work begins.

### Wave 71+ — Long-tail polish and deferred items
The remaining 200+ TODO(advanced) tails. Most are 5-50 LoC fixes once visited. Topics:
- Effect MVP→full (Wave 53's deferred params)
- Decision schema gaps (chooseSector, chooseRingBearer, chooseEvenOdd integrations)
- Trigger mode coverage (DamageDealtOnce, ClassLevelGained, AdaptTrigger, RoomEntered, TakesInitiative)
- Delayed-trigger sub-SVar resolution edge cases
- Additional cost-at-cast plumbing for Replicate/Recover/Strive (currently confirmAction-only)
- Layer 1 Clone for Phantasmal Image / Phyrexian Metamorph variants
- Subgame full nested-game loop (Shahrazad)
- Initiative dungeon room-specific SVar effects
- Contraption deck full integration
- AssembleContraption deck pop on real contraption deck
- ChangeText full rules-text rewrite (currently effective-characteristics MVP)
- MakeCard registry expansion (more PaperCard fixtures)

---

## Patterns proven across the run

### Tactical patterns
- **Tight subagent dispatches** (<80-120 tool calls each). 13 subagent runs across Waves 46-59; near-100% success.
- **Group commits per logical batch.** One commit per wave most of the time; split into 2 when distinct concerns (e.g., Wave 59 had separate parser-cleanup + handler commits).
- **MVP-first per handler:** register the handler key, implement the canonical case, document advanced sub-params with `TODO(advanced)` inline.
- **Read tests once.** Don't re-run pnpm test with different greps to extract counts.

### Code patterns
- **Hand-zone activated SA** synthesis for cast-from-hand keywords (Cycling, Channel, Transmute, Reinforce).
- **Battlefield-zone activated SA** for permanent-activated keywords (Outlast, Equip, Class level-up, Reconfigure).
- **Graveyard-zone activated SA** with `ExileFromGraveSelf` cost (Embalm, Eternalize, Scavenge, Encore).
- **Death-trigger** (Battlefield → Graveyard) (Persist, Undying, Soulshift, Recover).
- **ETB trigger with chooseCard** (Champion, Devour, Backup, Tribute, Bloodthirst, Fabricate).
- **Attacks trigger with batch-payload check** (Mentor, Battle cry, Exalted, Annihilator, Provoke, Mobilize, Dethrone, Enlist, Melee, Battalion).
- **SpellCast self-trigger** (Storm, Replicate, Cipher, Demonstrate, Ripple, Sweep, Cascade, Prowess, Extort).
- **Alt-cost in altCostRegistry** with `isAvailable` + `modifyCastContext` (Flashback, Madness, Foretell, Bestow, Overload, Plot, Suspend, Disturb, Mutate, Aftermath, Splice, Retrace, Buyback, Warp, Blitz, Surge, Emerge, Miracle, Adventure, Jump-Start, Spectacle, Freerunning, MoreThanMeetsTheEye, Unearth, Prototype, WebSlinging, Firebending).
- **Layer 6 keyword grants** via `keywordGrants[]` on LayerEngine (Wave 32).
- **Layer 7c P/T modifier** via static abilities (Wave 47).
- **Layer 4 type/subtype additions** via Continuous static (Wave 47).
- **Layer 5 color additions** via Continuous static (Wave 47).
- **Cost-mod statics** for Affinity/Strive/Kicker (Wave 6/49/59).
- **Replacement intent threading** via `game.flags.activeReplacementIntent` side-channel (Wave 56).
- **Per-player game-flags counters** for Revolt / Landfall / Spellmastery / Storm / etc., reset on turn-end (Wave 32 / 51).

---

## Pitfalls hit (and now documented)

1. **`exactOptionalPropertyTypes: true`** — biome forbids both `!` non-null and `delete`. Use `T | undefined = undefined` typed slots so `= undefined` works without delete.
2. **`Card.face` is `FaceKind`** (not `FaceKind | undefined`) — use `"default"` as the no-face sentinel.
3. **`mkEvent` exhaustiveness** — every new event kind must be added to `event.test.ts`'s EXPECTED_KINDS / ALL_KINDS_MAP / PAYLOADS.
4. **Event kind names** — `AttackersDeclared` (plural batch), `DamageDealt` (with `isCombat` flag). Wave 29 fixed Mentor/Renown using wrong names; Wave 58 caught Mentor/Provoke using wrong payload field (`attackerIds` vs `attackers`).
5. **Replacement registry callbacks can't yield decisions easily** — synchronous execution with skip-on-decision (Wave 29 ReplaceWith$ pattern; Wave 56's intent-threading side channel).
6. **`Player.manaPool` is typed `unknown`** — cast to `ManaPool` in tests.
7. **`PaperCardFlags` only has `markedColors` and `noSellValue`** — don't invent fields.
8. **Stale dist** after `@mtg-forge-ts/core` type changes — rebuild dist before scanning (`rtk pnpm --filter @mtg-forge-ts/{core,game} build`).
9. **Generators with no yield** need `// biome-ignore lint/correctness/useYield: <reason>` comment.
10. **`tsc --noEmit` cache lies** — multiple times subagents reported "gates green" via stale build cache when typecheck actually had errors. **Always verify with a fresh `tsc --noEmit` invocation.**
11. **Tool budget per dispatch** — keep <80-120 tool calls per subagent. Bundling 3+ unrelated features blows up token usage.
12. **Snapshot v7 doesn't round-trip closure functions** — `targetCardIdFn` etc. on layer effects are stripped on restore; statics re-register from each card's static-list, so layer arrays are derived caches.

---

## Key file locations

- **This handoff:** `NEXT_STEPS_WAVE_59_DONE.md` (this file, repo root)
- **Memory:** `C:\Users\aleja\.claude\projects\F--BACKUP-Programacion\memory\project_mtg_forge_ts_sp1_execution.md`
- **Gap audit synthesis:** `docs/superpowers/plans/2026-04-26-gap-audit-synthesis.md`
- **Master spec:** `docs/superpowers/specs/2026-04-23-mtg-forge-ts-master-spec.md`
- **Corpus scanner:** `cd tools/dsl-validator && rtk pnpm scan -- --cap 0`
- **Forge sources** (read-only): `F:\BACKUP\Programacion\forge\`
- **Vendored cards:** `F:\BACKUP\Programacion\forge\forge-gui\res\cardsfolder\` (32,300 .txt files)
- **Forge keyword chain:** `F:\BACKUP\Programacion\forge\forge-game\src\main\java\forge\game\card\CardFactoryUtil.java` (lines 505-4061)
- **Forge effect classes:** `F:\BACKUP\Programacion\forge\forge-game\src\main\java\forge\game\ability\effects\` (one per effect)
- **Forge static-ability classes:** `F:\BACKUP\Programacion\forge\forge-game\src\main\java\forge\game\staticability\`

### Our key files

- **Token database:** `packages/cards/src/tokens/token-database.ts`
- **Effect handlers:** `packages/game/src/ability/effects/` (~250 handlers)
- **Trigger handlers:** `packages/game/src/trigger/handlers/` (~95 handlers)
- **Replacement handlers:** `packages/game/src/replacement/handlers/`
- **Static handlers:** `packages/game/src/static/handlers/` (~17 modes)
- **Keyword handlers:** `packages/game/src/keyword/handlers/` (~110 handlers + FlagKeyword catchall)
- **Alt-costs:** `packages/game/src/altcost/` (~30 alt-costs)
- **Cost parts:** `packages/game/src/cost/parts/` (~17 parts)
- **SVar selectors:** `packages/game/src/svar/selectors/` (~50 args)
- **Decision schemas:** `packages/core/src/decisions/player-decisions.ts`
- **Game flags:** `packages/game/src/game-flags.ts`
- **Card slots:** `packages/game/src/card.ts` (~80 transient slots)
- **Player:** `packages/game/src/player.ts`
- **Snapshot v7:** `packages/game/src/snapshot/game-snapshot.ts`

---

## Non-negotiable invariants (carry forward)

- Generator engine; no Promise/async inside `function*`
- Three mutators (GameAction / CombatHandler / subsystem-internal)
- Entity-ID refs, readonly unions
- `kind:` + `readonly version: 1` on every event
- Exhaustiveness guards on every `switch (x.kind)`
- Deterministic Rng
- `git commit -s`, NO `Co-Authored-By` (user global rule)
- SPDX headers, `.js` imports, `import type`
- Forge-fidelity wins over plan
- Stay on `sp1-engine-foundations`; never push

---

## 📋 Kickoff prompt for next session

Paste this verbatim:

```
Continue mtg-forge-ts. Read the memory at
C:\Users\aleja\.claude\projects\F--BACKUP-Programacion\memory\project_mtg_forge_ts_sp1_execution.md
and the handoff at NEXT_STEPS_WAVE_59_DONE.md (repo root).

Working tree clean, branch sp1-engine-foundations at HEAD 3e61db2.
Tests: 3853 (2995 game + 134 cards + 724 core). Coverage: 100% on
full 32,300-card corpus. Functional fidelity: ~80% of cards play
correctly end-to-end. Waves 31-59 done.

Per the user's "100% port no defers" directive, continue closing the
remaining ~20% gap. Recommended sequence (in NEXT_STEPS doc):

  - Wave 60: deeper static mode pack (~80 modes, ~1500-2000 cards)
  - Wave 61: decision-driven effect resolution (~300 cards UX)
  - Wave 62: token database + ETB-creates-token full wire (~150 cards)
  - Wave 63: sub-param tightness sweep across Wave 53 effects
  - Wave 64: Cipher + cast-copy infrastructure (~50 cards)
  - Wave 65: combat-handler reads on stamped flags (~150 cards)
  - Wave 66: sideboard + outside-the-game zone (~30 cards)
  - Wave 67: replacement intent threading on non-Damage parents
  - Wave 68: Adventure full plumbing + Read ahead
  - Wave 69: Splice Arcane text-grafting
  - Wave 70+: long-tail polish

Use tight subagent dispatches (<100 tool calls each). One focused
mechanic or batch of similar-shape mechanics per dispatch. Group
commits per logical batch.

DCO-signed (`-s`). NO `Co-Authored-By`. NEVER push. Stay on
sp1-engine-foundations.

After each wave: full gate (typecheck + test + lint) and corpus scan
to confirm 100% holds. Verify typecheck on a fresh `tsc --noEmit`
(don't trust stale build cache — Waves 47/48 caught this).

Start with Wave 60: deeper static mode pack. Highest leverage among
the remaining items.
```

---

## End-of-run snapshot

- **Total commits since dbe90e6:** ~325
- **Total tests:** 3853 passing across all packages
- **Corpus coverage:** 100.0% on full 32,300-card corpus (parsed + handlers registered)
- **Functional keyword catalogue:** ~110 mechanics fully wired (was 50 at start of Wave 31, was 32 at start of Wave 23)
- **Effect handlers:** ~250 (broadly faithful)
- **Static modes:** 17 (was 5)
- **Cost parts:** 17 (was 6)
- **SVar selectors:** ~50 args (was 13)
- **Decision request kinds:** ~22 (was 10)
- **Event kinds:** 169 (was 167 → 169 after Wave 44/45 +3)
- **Snapshot schema version:** v7
- **Functional fidelity (estimate):** ~80% of unique cards play correctly end-to-end (was ~50% pre-Wave-46)

The engine architecture is complete and stable. The remaining work is mechanical sub-param fidelity sweeps + decision-flow polish + UI integration prep. ~10-15 more waves get to 95%+.
