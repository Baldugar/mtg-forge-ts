# 🎯 100% Forge Corpus — Handoff Document

> **Milestone reached:** Full 32,300-card Forge corpus parses cleanly with every handler key, trigger mode, replacement event, and keyword resolved against the live registries. 0 parser errors. 0 unknown handler keys.

## State of the world (snapshot)

- Repo: `F:\BACKUP\Programacion\mtg-forge-ts`
- Branch: `sp1-engine-foundations` (local only; never pushed)
- HEAD: post-`4b2d414` (Wave 22b — final 7 effect handlers)
- ~245 commits since `dbe90e6` (end of SP2 Round 1 remediation)
- ~3200 tests passing
- **Cap-5000 corpus**: 100.0% (5000/5000 cards parse clean)
- **Full 32,300-card corpus**: 100.0% (32300/32300 cards parse clean)

## What was accomplished (Waves 6-22b)

| Wave | Scope | Key landing |
|---|---|---|
| 6 | Cost-mod runtime | StaticHandler framework, ReduceCost/RaiseCost handlers, applyCostMods, Jet Medallion flagship |
| 7 | Madness alt-cost | Cast-from-exile-to-graveyard, Fiery Temper flagship |
| 8 | Activated-ability targets | CR 602.1b target selection, Prodigal Sorcerer flagship |
| 9 | EOT cleanup hook | ContinuousEffectRegistry.registerCleanup, Protection EOT |
| 9b | AbilityCastTrigger | 11 unit tests verifying activated-vs-cast trigger separation |
| 10 | Foretell/Bestow/Overload | 3 alt-costs, Augury Raven + Boon Satyr + Blustersquall flagships |
| 11 | Cost-mod completeness | MinMana$, OnlyFirstSpell$, AffectedZone$, Cost$ colored, SetCost, Amount$ X |
| 12 | Color filters + once-per-turn | nonBlack/nonRed/nonColorless enforced, DamageDoneOnce/CounterAddedOnce, Count$Domain |
| 13 | Cascade + EffectEffect | Cascade keyword, full delayed-trigger-host semantics |
| 14 | "Niche" mechanics | ChaosEnsues, SetInMotion, Always, GameWin/GameLoss, CountersRemain |
| 14b | D2 follow-ups | IsPresent$ on Always, CountersRemain runtime, Exquisite Archangel ReplaceWith$ |
| 15 | 20 effect handlers | AddTurn, Fog, Reveal, ChooseGenericOption, NameCard, ChoosePlayer, etc. |
| 16 | 20 trigger handlers | LandPlayed, ManaSpent, AttackerUnblocked, TurnBegin, etc. + 16 new event kinds |
| 17 | 6 replacement handlers | DrawCards, PayLife, Cascade, RollDice, Mill, Destroy |
| 18 | 32 long-tail handlers | ControlSpell, SacrificeAll, MultiplyCounter, Investigate, Vote, etc. + 6 trigger events + parser fixes (SPECIALIZE, MeldPair) |
| 19 | 36 long-tail handlers | DiscardedAll, ManaAdded, ExcessDamage, Goad, Discover, etc. |
| 19b | Final cap-5000 closeout | FlippedCoin, Destroyed, ChangesController, Exploited (cap-5000 → 100%) |
| 20 | 33 long-tail full-corpus | Specializes (47 cards!), ProduceMana, Proliferate trigger, Phyrexian unbraced parse |
| 21 | 40 long-tail full-corpus | Proliferate effect, Venture, Manifest, Explore, Vote effect, etc. |
| 22 | 34 long-tail full-corpus | Detain, DayTime, Poison, Meld, ProtectionAll, Stationed, BlockersDeclared, etc. |
| 22b | Final 7 singletons | ImmediateTrigger, RestartGame, Endure, Learn, ReorderZone, OpenAttraction, MultiplePiles |
| Batch E | 11 audit findings | A-004, I-3, I-5, I-6, I-8, I-11, I-12, I-14, I-16, I-17, Stack.copy re-parent |
| Batch F | Token database | 36 predefined tokens (Soldier, Treasure, Food, etc.) + TokenScript$ resolution |

## What's still NOT done (full work breakdown for the next session)

The corpus is 100% parsed-and-handler-registered, but functional gameplay for many cards depends on engine-side mechanics not yet implemented. **Per the user's "no defers, 100% port" directive, all of these need to land.**

### A. Engine-side EMIT wiring for new event kinds (Wave 16b/17b/18b/19b/20b/21b/22b)

The handler registries listen for ~50 new event kinds added across Waves 14-22. The engine doesn't yet FIRE most of them. Tests synth-emit for verification, but real cards won't trigger until the underlying mechanic emits at runtime. Priority list:

1. **LandPlayed** — emit from `game.action.playLand` (Cultivator Colossus, Lotus Cobra). Probably highest-impact event; easy to wire.
2. **ManaSpent / TapsForMana / ManaAdded / ProduceMana** — emit from `mana-pool.add()` and `cost-mana.pay()`. Mana-trigger family.
3. **CrimeCommitted** — emit from `target-system` when an opponent target is selected.
4. **Crewed / BecomesCrewed / Saddled / BecomesSaddled** — emit from a Crew/Saddle activated-ability orchestrator (Vehicles & Mounts).
5. **CardSpecialized** — needs full Specialize keyword runtime (face-flip into colored variants). 47 cards.
6. **CardCranked / AdvanceCrank** — needs Contraption mechanic (Unstable).
7. **RingTempted / RingTemptsYou** — needs Ring tracker (LotR).
8. **PlaneswalkedTo / PlaneswalkedFrom / PlanarDieRolled** — needs Planechase orchestrator.
9. **Mentored** — needs Mentor keyword (Ravnica Allegiance).
10. **CardMutated / Mutates** — needs full Mutate mechanic.
11. **DungeonCompleted** — needs Dungeon tracker (Adventures in the Forgotten Realms).
12. **Stationed** — needs Vehicle station mechanic.
13. **VisitAttraction** — needs Attraction visit (Unfinity).
14. **CardForage** — Forage mechanic (Bloomburrow).
15. **CaseSolved** — needs Case solving mechanic (Murders at Karlov Manor).
16. **CardEvolved** — Evolve trigger emit on creature ETB compare.
17. **CardChampioned** — Champion mechanic.
18. **CardTrained** — Train mechanic.
19. **DayTimeChanged** — emit from upkeep day/night transition logic.
20. **CardScryed** / **PlayerScryed** — emit from `game.action.scry`.

(Plus ~20 more single-card events.)

### B. Proper mechanic implementations (handlers exist as MVP/stubs)

These have a registered handler but the canonical mechanic isn't fully implemented; cards using them will resolve incorrectly:

- **Specialize** (47 cards) — face-flip into one of 5 colored variants with chosen-color SVar.
- **Plot** (Bloomburrow) — exile from hand at sorcery speed for plot cost; cast for free later.
- **Mutate** (Ikoria) — cast for mutate cost, merge with another creature.
- **Convoke** — tap creatures to substitute mana when casting.
- **Improvise** — tap artifacts to substitute generic mana.
- **Suspend** — exile with time counters; cast when last counter removed.
- **Conspire** — tap two creatures sharing a color with the spell to copy it.
- **Crew** — tap creatures (total power ≥ N) to turn Vehicle into a creature.
- **Saddle** — tap creatures (total power ≥ N) to turn Mount into a saddled creature.
- **Champion** — exile a matching creature on ETB; return when the championing creature leaves.
- **Echo** — pay echo cost at next upkeep or sacrifice.
- **Cumulative Upkeep** — accumulating upkeep costs via age counters.
- **Initiative / Monarch** — combat-damage transfer + EOT card draw.
- **Day/Night** — automatic transitions based on prior turn casts.
- **Day-bound / Night-bound** — face-flip on day/night transition.
- **Disturb** — flashback variant that flips the card.
- **Foretell action** (the inbound side; alt-cost done in Wave 10).
- **Fortell `ExileOnMoved$` cleanup** (wired but EffectEffect's host-leave watcher needs verification).

### C. SVar selectors / decisions still missing or stubbed

- **Count$ManaSpent**, **Count$NumColors**, **Count$Devotion**, **Count$Mountains** (all per-color-basic), etc. — many `Count$<arg>` forms aren't registered.
- **Count$Power / Count$Toughness** of a defined card.
- **chooseDirection** decision request (Wave 18 had to fall back to deterministic "Left").
- **chooseEvenOdd** decision request.
- **chooseLearnOption** / **chooseEndureOption** / **chooseVillainousOption** — multi-option binary choices with sub-ability dispatch.
- **chooseSector** — Doctor Who.
- **chooseGenericOption** decision was added but the handler doesn't always wire correctly.

### D. Token activated abilities

The token database (Wave Batch F) has 36 entries but artifact tokens (Treasure, Food, Clue, Blood, Powerstone) have empty `abilities: []`. Need to populate the activated-ability ASTs for each so:
- Treasure: `{T}, Sacrifice this artifact: Add one mana of any color`
- Food: `{2}, {T}, Sacrifice this artifact: gain 3 life`
- Clue: `{2}, Sacrifice this artifact: draw a card`
- Blood: `{1}, {T}, Discard a card, Sacrifice this artifact: draw a card`
- Powerstone: `{T}: Add {C}; spend only on non-creature spells/abilities`

### E. ReplaceWith$ SVar dispatch on 6 Wave-17 replacements

DrawCards/PayLife/Cascade/RollDice/Mill/Destroy replacements register the `ReplaceWith$` param but don't yet evaluate the SVar's ability and route the alternate intent. Mirror the GameLoss-replacement pattern (commit `cd1eb6c`).

### F. MVP→full upgrades flagged across waves

- **Clone** (Wave 18) — Layer-1 copyable-effect proper impl (currently records on remembered).
- **Balance** — per-zone restrictions (currently hand+lands+creatures).
- **AssembleContraption** — full contraption deck.
- **ManaReflected** — enumerate candidate permanents' mana abilities.
- **ChangeText** — Layer 1/4 application.
- **MakeCard** — CardDb materialization.
- **DelayedTrigger** — full trigger-stack-push routing.
- **CountersRemain** runtime — auto-clear hook on zone-leave is wired but needs E2E flagship verification.

### G. Pre-SP3 audit follow-ups (already closed in Batch E, listed for completeness)

A-004 / I-3 / I-5 / I-6 / I-8 / I-11 / I-12 / I-14 / I-16 / I-17 / Stack.copy re-parent — all closed in Batch E (HEAD `efeea5d`).

## Recommended next session order

The 7 work groups above are mostly independent. Recommended order by impact:

1. **B + A combo for highest-value mechanics first**: Specialize (47 cards), Mutate, Plot, Convoke. Each pairs the keyword runtime with its emit-side.
2. **A — straightforward emit-wiring** for LandPlayed, ManaSpent, CrimeCommitted, Crewed, Saddled. These are mostly hookups in existing engine paths.
3. **C — SVar selectors** for the most-used Count$ forms. Each is a small selector function.
4. **D — Token activated abilities** for the 5 artifact tokens.
5. **E — ReplaceWith$ SVar on 6 replacements**. Small.
6. **F — MVP→full upgrades**. Mixed; tackle based on test failures.

## Patterns proven this session

- **Forge-fidelity wins over plan**: when in doubt, mirror Forge's actual DSL semantics.
- **MVP-first per handler**: register the handler key, implement the canonical case, document advanced sub-params with `TODO(advanced)` inline — don't gate on full impl.
- **Tight subagent dispatches** (<80 tool calls each). Bundling 3+ unrelated features blows up tool counts.
- **Group commits per logical batch**: 1 file with 20 classes is one commit, not 20.
- **TDD per handler**: one smoke test per class minimum.
- **Side-effect imports for handler registration**: each handler self-registers on import; barrels `index.ts` propagate.
- **Coverage-driven prioritization via corpus scanner**: `cd tools/dsl-validator && rtk pnpm scan -- --cap 0` is the killer move. Each wave's "what's left" comes from the latest scan output.

## Pitfalls to avoid

1. **Tests run multiple times**: pnpm test outputs the per-package summary. Run ONCE, read the full output. Don't re-grep.
2. **Stale dist**: after touching `@mtg-forge-ts/core` or `@mtg-forge-ts/game` types, rebuild dist before scanning (`rtk pnpm --filter @mtg-forge-ts/{core,game} build`). The validator tsx-runs but type changes propagate via dist.
3. **Card.face is `FaceKind`** (not `FaceKind | undefined`) — use `"default"` as the no-face-selected sentinel.
4. **`game.cards` Map** holds cards in ALL zones. Filter on `card.zone` when iterating.
5. **`exactOptionalPropertyTypes: true`**: spread-conditional for optional keys.
6. **Biome forbids `!` non-null assertions**.
7. **`mkEvent` exhaustiveness**: every new event kind must be added to `event.test.ts`'s EXPECTED_KINDS / ALL_KINDS_MAP / PAYLOADS. Wave 19/20/21/22 each had to update these.

## Key file locations

- Memory: `C:\Users\aleja\.claude\projects\F--BACKUP-Programacion\memory\project_mtg_forge_ts_sp1_execution.md`
- Handoff (this file): `docs/superpowers/plans/2026-04-26-100-percent-corpus-handoff.md`
- Master spec: `docs/superpowers/specs/2026-04-23-mtg-forge-ts-master-spec.md`
- Corpus scanner: `cd tools/dsl-validator && rtk pnpm scan -- --cap 0` → coverage report
- Forge sources: `F:\BACKUP\Programacion\forge\` (read-only)
- Vendored cards: `F:\BACKUP\Programacion\forge\forge-gui\res\cardsfolder\` (32,300+ .txt files)
- Token database: `packages/cards/src/tokens/token-database.ts`
- Wave handlers: `packages/game/src/{ability/effects,trigger/handlers,replacement/handlers,static/handlers,keyword/handlers,altcost}/`

## Suggested kickoff for next session

```
Continue mtg-forge-ts. Read the memory at
C:\Users\aleja\.claude\projects\F--BACKUP-Programacion\memory\project_mtg_forge_ts_sp1_execution.md
and the handoff at docs/superpowers/plans/2026-04-26-100-percent-corpus-handoff.md.

Working tree is clean. Branch sp1-engine-foundations at HEAD post-4b2d414.
Corpus 100% parsed-clean and handler-registered. ~3200 tests.

Next priorities (ordered by impact):
1. Specialize keyword runtime + CardSpecialized emit (47 cards)
2. Mutate, Plot, Convoke, Crew/Saddle keyword runtimes
3. Engine-side emit for LandPlayed/ManaSpent/CrimeCommitted (highest-traffic)
4. Token activated abilities (Treasure/Food/Clue/Blood/Powerstone)
5. ReplaceWith$ SVar dispatch on 6 Wave-17 replacements
6. MVP→full upgrades (Clone Layer-1, Balance per-zone, etc.)

Use tight subagent dispatches (<80 tool calls each). Group commits.
DCO-signed (`-s`). NO `Co-Authored-By`. NEVER push.
```
