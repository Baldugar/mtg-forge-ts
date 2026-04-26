# 🎯 Finish Everything — Forge Port Final Handoff

> **Mission:** Close every remaining gap in the mtg-forge-ts port. The corpus is 100% parsed-and-handler-registered; this handoff is for the next session to land the final long-tail of keyword runtimes, sub-param upgrades, and edge cases. No defers. No skips. No "niches."

## State snapshot

- Repo: `F:\BACKUP\Programacion\mtg-forge-ts`
- Branch: `sp1-engine-foundations` (local only; never pushed)
- HEAD: post-`cbc6184` (Wave 30+ — Mentor/Renown event-kind fix + handoff doc)
- ~290 commits since `dbe90e6`
- **Tests: ~3362** (game 2503 + cards 127 + core 720 + dsl-validator 12)
- **Coverage: 100.0%** on full 32,300-card Forge corpus (parser-clean + all handler keys registered)
- All gates green: typecheck, test, build, lint, DCO

## What's done (Waves 6-30)

### Frameworks complete
- DSL parser (multi-face, KeywordIds, all line types, Phyrexian unbraced, SETCOLORID/Lights/MeldPair tolerated)
- Structural + semantic validators + corpus scanner CLI
- SVar evaluator with 14+ selectors (Count$Domain, Count$Power/Toughness/CMC, common-counts pack, etc.)
- Cost framework: CostMana (color-aware solver + restrictions), CostTap, CostPayLife, CostSacrifice, CostDiscard, CostForage
- Effect framework: SpellAbilityEffect base + 250+ registered handlers
- Trigger framework: TriggerHandler + 100+ registered handlers
- Replacement framework: ReplacementHandler + 25+ handlers + ReplaceWith$ synchronous execution
- Static handler framework: ReduceCost / RaiseCost / SetCost / Continuous + cost-mod-filter language
- Keyword handler framework: 32 functional mechanics (see catalogue below)
- Cast pipeline: full 10-step generator + alt-cost integration (Flashback, Madness, Foretell, Bestow, Overload, Plot, Suspend, Disturb, Mutate)
- Activate-ability pipeline: per-ability `activeInZones` + target selection (CR 602.1b)
- AltCostRegistry, FreeCastPipeline, ContinuousEffectRegistry with onExpiry hooks
- Layer engine (CR 613) with deriveBaseCharacteristics + Bestow/Crew/Specialize/Mutate type-flips
- Token database (36+ entries) + TokenScript$ resolution + activated abilities (Treasure/Food/Clue/Blood/Powerstone)

### 32 keyword mechanics complete
Cycling, Flashback, Madness, Foretell, Bestow, Overload, Cascade, Plot, Specialize, Convoke (with color-pip), Improvise, Crew, Saddle, Mutate, Suspend, Conspire, Champion, Echo (full payment), Cumulative Upkeep, Day/Night auto-transitions, Initiative + combat-transfer, Monarch + end-step draw + combat-transfer, Evolve, Station, VisitAttraction, Forage, Adapt, Renown, Mentor, Disturb, Daybound/Nightbound auto-flip, Storm, Ninjutsu, Graft, Modular, Living Weapon, Riot, Rebound.

### 18+ engine-side event EMITs wired
LandPlayed, ManaSpent, CardSpecialized, CardPlotted, CrimeCommitted, Investigated, CardCranked, CardDiscovered, CardsTappedAll, CardsUntappedAll, LifeLost, Crewed, Saddled, CardEvolved, CardStationed, AttractionVisited, CardForage, CardMutated, BecameMonarch / LostMonarch, BecameInitiative, DayTimeChanged.

### 25+ flagship E2E tests
Lightning Bolt, Healing Salve, Mulldrifter, Llanowar Elves, Disenchant, Wrath of God, Giant Growth, Counterspell, Soul Warden, Divination, Doom Blade, Path to Exile, Negate, Forgotten Cave (Cycling), Cigar Burn (Flashback), Jet Medallion (cost-mod), Fiery Temper (Madness), Augury Raven (Foretell), Boon Satyr (Bestow), Blustersquall (Overload), Bituminous Blast (Cascade), Yavimaya Sojourner (Domain), Prodigal Sorcerer (activated targets), Smuggler's Copter / Heart of Kiran (Crew), Mount tests (Saddle), Mutate (Brokkos-shape), Wave 26-30 keyword smoke tests.

## Gap inventory — what's still left

### A. Substantial mechanic gaps (priority)

These have NO runtime today; cards using them won't function correctly:

1. **Battle card type** (March of the Machine) — siege markers, attack/defend phases. ~50+ cards.
2. **Persist / Undying** — death-replacement returns the creature with -1/-1 (Persist) or +1/+1 (Undying). ~30 cards.
3. **Soulbond** (Avacyn Restored) — pair creatures on ETB; abilities apply while paired. ~15 cards.
4. **Constellation** (Theros: Beyond Death) — enchantment ETB triggers ANY enchantment ETBs. ~20 cards.
5. **Threshold** (Odyssey) — passive based on `≥7 cards in graveyard`. ~30+ cards.
6. **Devour** (Alara) — sacrifice creatures on ETB for +1/+1 counters. ~10 cards.
7. **Dredge** (CR 702.52) — replace draw with mill+return. ~25 cards.
8. **Companion** (Ikoria) — 8th-card sideboard slot with deck-building constraint. ~10 cards.
9. **Hideaway** (Lorwyn) — exile a card on ETB; cast under a condition later. ~10 cards.
10. **Sunburst** (Mirrodin) — ETB with X counters where X = colors of mana spent. ~15 cards.
11. **Phasing keyword** (CR 702.26) — phases out at end of turn, in at next untap. ~30 cards.
12. **Eternalize / Embalm** (Amonkhet) — exile from graveyard, create token copy. ~30 cards.
13. **Aftermath** (Amonkhet) — split-card cast from graveyard for second half. ~25 cards.
14. **Channel** (Modern Horizons) — discard from hand, activate ability. ~20 cards.
15. **Bushido** (Kamigawa) — combat conditional +N/+N. ~30 cards.
16. **Vanishing / Fading** (Urza's, Time Spiral) — countdown-on-upkeep mechanics. ~20 cards.
17. **Outlast** (Khans of Tarkir) — activated ability for +1/+1 counter. ~10 cards.
18. **Wither / Infect** — Layer 6 keyword grant (damage as -1/-1 counters). ~50 cards.
19. **Soulshift** (Kamigawa) — death-trigger return Spirit from graveyard. ~30 cards.
20. **Splice** (Kamigawa) — pay alt-cost to add this card's text to a spell. ~20 cards.
21. **Transmute** (Dissension) — discard + 2: tutor a card with same CMC. ~10 cards.
22. **Replicate** (Guildpact) — pay replicate cost N times to copy. ~10 cards.
23. **Provoke** (Onslaught) — combat: force a creature to block. ~15 cards.
24. **Battalion** (Gatecrash) — combat trigger when attacking with 3+. ~10 cards.
25. **Strive** (Journey into Nyx) — additional cost per extra target. ~15 cards.
26. **Constellation, Skulk, Revolt, Scavenge, Sweep, Recover, Retrace, Reinforce, Friends Forever, Tempting Offer, Ripple, Sunburst** — 1-15 cards each.
27. **Subgame** (Shahrazad) — full nested-game run. 1 card.

### B. Engine-side EMIT for remaining stub events

Events listed in `event.ts` whose handlers exist but engine doesn't fire them yet:
- CardChampioned, CardTrained, PrizeClaimed, ClaimPrize-trigger, Stationed (DONE), CardsUntappedAll (DONE), CardCranked (DONE)
- Mentored: needs full Mentor mechanic emit — handler exists but emit-side not yet from combat-handler
- BecomesPlotted: handler exists; emit from PlotEffect (verify)
- Saddled: emit from SaddleEffect (verify)
- LandPlayed: wired but only from `playLand` mutator — verify all play-land call sites use it
- ManaSpent: wired in CostMana — verify activated-ability path also emits

### C. Cost-mod / SVar selector gaps

- **Count$NumColors** — number of colors of source / target.
- **Count$Devotion to <color>** — count colored mana symbols in permanents you control.
- **Count$Mountains / Plains / Islands / Swamps / Forests** — basic-land subtype count.
- **Count$ManaSpent** — color-mana spent for X.
- **Count$Powers / Count$Toughness** of defined cards.
- **Count$Storm** — number of spells cast this turn (pair with Storm keyword).
- **Count$ValidGraveyard / ValidExile / ValidBattlefield** with full filter language (currently only basic forms work).

Each is a small selector (~30-50 lines).

### D. MVP→full upgrades flagged inline

- **Powerstone** restriction — solver-side enforcement DONE; verify it covers activated-ability path with creature source.
- **Convoke** — color-pip path uses single Color, but creatures with multi-color identity (e.g., Bant Sureblade) should accept any of their colors.
- **Echo** "came under your control since last upkeep" — currently MVP just consults `echoOwedCost` (set on ETB; cleared on first paid upkeep). Forge's actual rule needs control-since-tracking.
- **Champion** — match-type case-tolerance done; full multi-keyword Subtype matching may need polish.
- **Mutate** — current impl handles top/bottom merge; verify trigger-inheritance from full pile (multiple bottom cards).
- **AddTurn** — extra-turn queue exists; verify ExtraTurnDelayedTrigger$/Execute$ payload sub-handler when present.
- **Effect** (delayed-trigger host) — Triggers$/ReplacementEffects$/StaticAbilities$ work; full trigger-stack-push routing for `Triggers$ <Mode$>` needs verification.
- **Subgame** — registered no-op stub; full impl deferred.
- **Initiative dungeon advance** — tracker holds seat; no Undercity dungeon state machine yet.
- **AssembleContraption** — records count on flags.attractions; contraption deck integration deferred.
- **ChangeText** — stores records on `card.textChanges`; Layer 1/4 application deferred.
- **MakeCard** — synthesizes placeholder PaperCards; full CardDb materialization deferred.
- **ManaReflected** — MVP records intent but doesn't enumerate candidate permanents' mana abilities.
- **DelayedTrigger** drives sub-SVar resolution synchronously; full trigger-stack-push routing deferred.
- **Rebound** — provenance redirect relies on StackItemProvenance not being deep-frozen. Works today but fragile.

### E. Pre-SP3 audit findings (Batch E closed all 11; verify holds)

A-004, I-3, I-5, I-6, I-8, I-11, I-12, I-14, I-16, I-17, Stack.copy re-parent — all closed in Batch E (HEAD `efeea5d`). Nothing pending.

### F. Snapshot/restore round-tripping

- Many transient flags added in Waves 23-30 (`crewedUntilEot`, `saddledUntilEot`, `stationedUntilEot`, `championedTarget`, `echoOwedCost`, `ageCounters`, `suspendedCounters`, `hasteFromSuspend`, `phasedOut`, `goaded`, `removedFromCombat`, `mustBlockTargetId`, `chosenColors/Types/Players/Number/Direction`, `namedCard`, `textChanges`, `disturbed`, `plotted`, `plottedOnTurn`, `mutatedPile`, `mutatedInto`, `bestowed`, `renowned`, `riotChoseHaste`, `reboundUntilUpkeep`) are NOT round-tripped through GameSnapshot v6.
- Mid-turn snapshots will lose state. End-of-turn snapshots are clean (most flags clear on EOT).
- SP4 should bump schemaVersion to v7 and add the slots.

## Recommended order (highest leverage first)

1. **Wave 31** — Persist/Undying (death-replacement common pattern; 30 cards). Mirror Champion's LTB-trigger pattern.
2. **Wave 32** — Threshold + Constellation + Battalion + Revolt (passive/state triggers; ~70 cards). Each is a state-checking trigger.
3. **Wave 33** — Eternalize/Embalm + Aftermath (graveyard recursion; ~55 cards). Mirror Flashback alt-cost pattern.
4. **Wave 34** — Battle card type + siege markers (~50 cards). New permanent type.
5. **Wave 35** — Phasing keyword + Vanishing/Fading (countdown mechanics; ~50 cards).
6. **Wave 36** — Wither/Infect (Layer 6 keyword grant; ~50 cards).
7. **Wave 37** — Devour + Soulshift + Soulbond + Splice + Hideaway + Sunburst (~80 cards).
8. **Wave 38** — Channel + Transmute + Replicate + Recover + Retrace + Scavenge + Reinforce + Strive (~80 cards).
9. **Wave 39** — Bushido + Outlast + Provoke + Skulk + Friends Forever + Tempting Offer + Ripple + Sweep + Companion (~70 cards).
10. **Wave 40** — Aftermath + Dredge (~50 cards).
11. **Wave 41** — Engine-side EMIT verification + remaining sub-param upgrades.
12. **Wave 42** — SVar selector pack (NumColors, Devotion, Mountains/etc., ManaSpent, Powers/Toughness, Storm, full Valid* grammar).
13. **Wave 43** — Snapshot/restore v7 schema bump (round-trip all transient flags).
14. **Wave 44** — Subgame full impl (1 card; Shahrazad).
15. **Wave 45** — Initiative dungeon machinery + AssembleContraption deck + ChangeText Layer 1/4 + MakeCard CardDb + DelayedTrigger full routing.

## Patterns proven this session

- **Tight subagent dispatches** (<80 tool calls each). Bundling 3+ unrelated features blows up tool counts.
- **Group commits per logical batch**: 1 file with 20 classes is one commit, not 20.
- **MVP-first per handler**: register the handler key, implement the canonical case, document advanced sub-params with `TODO(advanced)` inline.
- **Keyword pattern**:
  - Hand-zone activated → Cycling pattern.
  - Battlefield activated (creature/artifact) → Crew/Saddle/Adapt pattern.
  - ETB trigger → Champion ETB+LTB pattern.
  - Cast-time trigger (Storm-style) → SpellCast(Card.Self) trigger emit copies.
  - Death replacement → Persist/Undying pattern (use replacement registry on Battlefield→Graveyard).
- **Alt-cost pattern**: register in `altCostRegistry`; `isAvailable` + `modifyCastContext`. Mirror Flashback (cast-from-graveyard) or Madness (cast-from-exile-to-graveyard).
- **Layer 4 type-flip via flag + Card field**: add `card.<flagName>UntilEot`; reads in `deriveBaseCharacteristics`; cleanup hook on ContinuousEffect expiry.

## Pitfalls to avoid

1. `exactOptionalPropertyTypes: true`: spread-conditional for optional keys, OR explicit `T | undefined = undefined` typed slots (so `= undefined` works without delete).
2. **Biome forbids both `!` non-null assertions AND `delete` operator** — use `T | undefined` typed slots + `= undefined` assignment.
3. `game.cards` Map contains cards in ALL zones — filter on `card.zone` when iterating.
4. **Tests run multiple times**: pnpm test outputs the per-package summary. Run ONCE, read the full output. Don't re-grep with different filters.
5. **Stale dist**: after touching `@mtg-forge-ts/core` or `@mtg-forge-ts/game` types, rebuild dist before scanning (`rtk pnpm --filter @mtg-forge-ts/{core,game} build`).
6. **Card.face is `FaceKind`** (not `FaceKind | undefined`) — use `"default"` as the no-face-selected sentinel.
7. **`mkEvent` exhaustiveness**: every new event kind must be added to `event.test.ts`'s EXPECTED_KINDS / ALL_KINDS_MAP / PAYLOADS.
8. **Event kind names**: `AttackersDeclared` (plural, batch), `DamageDealt` (with `isCombat` flag) — don't invent `AttackerDeclared` or `CombatDamageDealt` (Wave 29 had to fix this).
9. **Replacement registry callbacks** can't yield decisions easily — synchronous execution with skip-on-decision (Wave 29 ReplaceWith$ pattern).
10. **Subagent dispatches: keep briefs tight** — exact file paths, exact patterns, exact scope cuts. No "implement everything" briefs.
11. **`Player.manaPool` is typed `unknown`** — cast to `ManaPool` in tests.
12. **PaperCardFlags only has `markedColors` and `noSellValue`** — don't invent fields.

## Key file locations

- Memory: `C:\Users\aleja\.claude\projects\F--BACKUP-Programacion\memory\project_mtg_forge_ts_sp1_execution.md`
- This handoff: `docs/superpowers/plans/2026-04-26-finish-everything-handoff.md`
- Master spec: `docs/superpowers/specs/2026-04-23-mtg-forge-ts-master-spec.md`
- Corpus scanner: `cd tools/dsl-validator && rtk pnpm scan -- --cap 0` → coverage report
- Forge sources: `F:\BACKUP\Programacion\forge\` (read-only)
- Vendored cards: `F:\BACKUP\Programacion\forge\forge-gui\res\cardsfolder\` (32,300+ .txt files)
- Token database: `packages/cards/src/tokens/token-database.ts`
- Wave handlers: `packages/game/src/{ability/effects,trigger/handlers,replacement/handlers,static/handlers,keyword/handlers,altcost}/`
- Wave-N bundles: `packages/game/src/ability/effects/wave-{15-22}-effects.ts`, `packages/game/src/trigger/handlers/wave-{16,18-22}-triggers.ts`

## Suggested kickoff prompt for next session

```
Continue mtg-forge-ts. Read the memory at
C:\Users\aleja\.claude\projects\F--BACKUP-Programacion\memory\project_mtg_forge_ts_sp1_execution.md
and the handoff at docs/superpowers/plans/2026-04-26-finish-everything-handoff.md.

Working tree clean, branch sp1-engine-foundations at HEAD post-cbc6184.
Coverage 100% on full 32,300-card corpus. ~3362 tests. 32 functional keywords.

Per the user's "100% port, no defers" directive, finish everything left:
the substantial mechanic gaps (Persist/Undying/Threshold/Battle/Phasing/
Wither-Infect/etc.), the SVar selector pack, MVP→full upgrades on the
inline TODOs, and snapshot v7 round-tripping of transient flags.

Recommended order is in the handoff (Waves 31-45). Use tight subagent
dispatches (<80 tool calls each, ONE focused mechanic or batch of similar-
shape mechanics per dispatch). Group commits per logical batch.

DCO-signed (`-s`). NO `Co-Authored-By`. NEVER push. Stay on
sp1-engine-foundations.

After each wave: full gate (typecheck + test + lint) and corpus scan to
confirm 100% holds.
```
