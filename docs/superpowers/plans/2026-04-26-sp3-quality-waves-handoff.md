# SP3 Quality-Waves Handoff (post-compact resume prompt)

> **For the next session.** Paste this as the kickoff prompt. After loading, read the project memory file at `C:\Users\aleja\.claude\projects\F--BACKUP-Programacion\memory\project_mtg_forge_ts_sp1_execution.md` for full context.

---

## State of the world (snapshot at 2026-04-26)

- Repo: `F:\BACKUP\Programacion\mtg-forge-ts`
- Branch: `sp1-engine-foundations` (local only; never pushed)
- HEAD: `2de1a07` (`feat(game/altcost): AltCostRegistry + Flashback alt-cost`)
- **171 commits** since `dbe90e6` (end of SP2 Round 1 audit remediation)
- **2701 tests passing** (651 core + 118 cards + 1920 game + 12 dsl-validator)
- 18+ flagship cards play end-to-end (Lightning Bolt, Healing Salve, Mulldrifter, Llanowar Elves, Disenchant, Wrath of God, Giant Growth, Counterspell, Soul Warden, Divination, Doom Blade, Path to Exile, Negate, Soul Warden + Bears chain, Llanowar Elves → Bears mana sequence, two-player Counterspell, Forgotten Cave Cycling, Cigar Burn Flashback)
- 95.2% Forge corpus coverage (4758/5000 cards parse + handlers registered, but coverage ≠ working)
- All gates green: typecheck, test, build, biome, determinism lint, DCO

## User's standing directive

**"Binary, either it works or it doesn't, no middle grounds."**

This means:
- **Don't add coverage stubs.** Each new effect/trigger/replacement must genuinely work or be a clearly-documented narrow stub with a precise gap note.
- **Failing tests are signal.** When a flagship test fails, investigate root cause and fix — don't paper over.
- **Coverage % is vanity.** Flagship pass count is the real metric.
- Autonomous mode; no confirmation between tasks; full gate at every milestone boundary.
- Stay on `sp1-engine-foundations` (legacy name carries SP2+SP3+quality waves); never push.
- `git commit -s` (DCO); NO `Co-Authored-By` lines.
- SPDX headers; `.js` imports; `import type`; strict TS flags.

## What's working (don't re-do)

### Frameworks complete
- Parser (`@mtg-forge-ts/cards`): full DSL, multi-face, KeywordIds, freeform tolerant
- Structural validator + semantic validator + corpus scanner CLI (`tools/dsl-validator`)
- SVar evaluator with 10+ selectors INCLUDING SumPower/SumToughness/SumCMC (un-stubbed)
- Cost framework: CostMana (real solver) + CostTap + CostPayLife + CostSacrifice + CostDiscard
- Mana cost solver (color-aware greedy with hybrid/phyrexian/X)
- Effect framework: SpellAbilityEffect base + EffectRegistry + SpellAbility runtime
- Trigger framework: TriggerHandler + ChangesZone/Phase/Attacks/SpellCast/DealtDamage/etc.
- Replacement framework: ReplacementHandler + Moved/Damage/Untap/Counter/etc.
- Keyword framework: FlagKeywordHandler + CyclingKeywordHandler (synthesizes activated ability)
- Cast pipeline: full spell-cast + ValidTgts$ runtime enforcement + free-cast subclass (FreeCastPipeline)
- Activate-ability pipeline: `game.action.activateAbility(cardId, abilityIndex)` with per-ability `activeInZones`
- AltCostRegistry: Flashback implemented; pattern ready for Madness/Foretell/Bestow/Overload

### Effects with real (non-stub) implementations (~40)
DealDamage, Draw, Destroy, GainLife, LoseLife, Exile, ReturnToHand, ChangeZone, Sacrifice, Tap, Untap, Mill, Scry, PutCounter, RemoveCounter, Discard, Token, Animate, Pump, PumpAll, CounterSpell, Attach, Fight, Mana, DestroyAll, DamageAll, Regenerate, ChangeZoneAll, Charm, Effect, Dig, GainControl, PreventDamage (real shield consumption), ChooseCard, CopyPermanent, SetState, PutCounterAll, ChooseSource, RollDice (rng), FlipACoin (rng), Branch (real condition), Surveil, PeekAndReveal (CardsRevealed event), RevealHand (CardsRevealed), Play (FreeCastPipeline), ChooseColor (real decision), ChooseType (real decision), Protection (keyword grant)

### Trigger handlers functional
ChangesZone, Phase, Attacks, SpellCast, DealtDamage (DamageDone), AttackersDeclared, AttackerBlocked, AttackerBlockedByCreature, TurnFaceUp, Blocks, ChangesZoneAll, Sacrificed (CardSacrificed event fires), Discarded (CardDiscarded event fires), LifeGained, BecomesTarget (CardTargeted event fires), CounterAddedOnce, AbilityCast (AbilityActivated event), Cycled (CardCycled fires from Cycling), Drawn, Taps, Transformed

### Replacement handlers functional
Moved, DamageDone, Counter (cant-be-countered), CreateToken, AddCounter, Draw, Untap, GainLife, LifeReduced, TurnFaceUp

### Architecture wins this session
- `deriveBaseCharacteristics` reads `PaperCard.definition` (no more seedCreatureType workarounds)
- `FreeCastPipeline` subclass pattern (used by PlayEffect + AltCost paths)
- `SpellAbility.activeInZones` for Hand-zone activated abilities (Cycling)
- Shield-consumption via temporary `ReplacementAbility` with closure-tracked counter
- `AltCostRegistry` infrastructure
- `CardsRevealed`, `CardTargeted`, `AbilityActivated`, `CardCycled`, `CardDiscarded`, `CardSacrificed`, `RollDie`, `FlipCoin` events all wired
- ValidTgts$ runtime enforcement at cast time

## What's still stubbed/incomplete (precise gap list)

### Effects
- **TokenEffect TokenScript$ form** — needs token database (SP4)
- **EffectEffect** — runs SubAbility inline; full delayed-trigger host semantics deferred
- **Always trigger** — fires every event; defer (niche)
- **ChaosEnsues / SetInMotion** — Planechase / Archenemy specific; defer
- **DamageDoneOnce / CounterAddedOnce** — once-per-turn guard not implemented
- **Color filters in ValidTgts$** (`nonBlack`, `nonRed`) — parsed but not enforced; only type+controller filters enforced

### Replacements
- **GameWin/GameLoss** — `gameWin`/`gameLoss` MutationIntent kinds not yet in taxonomy
- **CountersRemain** — niche

### Architecture
- **Activated-ability targets** (Lightning Greaves equip pattern) — current activate pipeline is no-target only
- **Cost adjustments** (RaiseCost/ReduceCost/SetCost StaticAbilityModes) — registered but not consulted by mana solver
- **Madness / Foretell / Bestow / Overload alt-costs** — pattern exists via AltCostRegistry, just need each impl
- **Layer 6 keyword-grant EOT cleanup** — Protection adds keyword for game's duration; needs `onExpiry` callback wiring (Milestone J)
- **Cascade trigger + cascade event firing**
- **AbilityActivated for triggers** — verify whether SpellCastTrigger/AbilityCastTrigger now fire correctly with the new event

### Pre-SP3 audit findings still deferred
- A-004 (CastPipeline Card.face leak), I-3 (commander as replacement), I-5 (Layer 7e null P/T), I-6 (orderer empty branch), I-8 (delayed-trigger suppression), I-11 (registry source-id tagging), I-12 (SBA terminalState multiplayer), I-14 (Card.timestamp), I-16 (CDA-first cross-layer), I-17 (emblem controller), Stack.copy re-parent

## Recommended next moves (ordered by impact)

### High-leverage (each unlocks real archetypes)

1. **Cost adjustments runtime** — RaiseCost/ReduceCost/SetCost statics consulted by mana solver. Unlocks ~30+ cards (cost-modifier auras, anthems with cost reductions, Trinisphere-style raise-cost). Architecture: in `cost-mana.ts` or solver, query `staticEffectRegistry.byMode("RaiseCost")` etc., apply deltas before solving.

2. **Madness alt-cost** — registered via AltCostRegistry pattern; analogous to Flashback but cast trigger from discard event. Each Madness card adds ~1 archetype but it's a common keyword.

3. **Activated-ability targets** — Lightning Greaves equip ("Equip {0}: target creature") needs the activate pipeline to handle target selection like cast pipeline does. Significant refactor.

4. **Layer 6 keyword-grant EOT cleanup** — wire `onExpiry` callback on ContinuousEffectRegistry so Protection's `card.keywords` mutation gets reverted at EOT. Architectural fix improving correctness.

5. **AbilityActivated trigger firing** — verify the new AbilityActivated event makes SpellCastTrigger and AbilityCastTrigger fire for activated abilities. Likely just needs the SpellCastTrigger.matches() to also check AbilityActivated event kind, OR a new AbilityCastTrigger that's already registered.

### Validation / correctness depth
6. **ValidTgts$ color filters** (`nonBlack`, `nonRed`, `Card.cmcLE3`) — extend parseValidTgts + enumerateEligibleTargets. Each filter ≈ a few real cards.

7. **DamageDoneOnce once-per-turn guard** — track per-turn fired-state on the trigger to suppress re-fires.

### Bigger architectural pieces
8. **Effect (delayed-trigger host) full semantics** — creates a hidden permanent that hosts triggers. Needed for "at the beginning of your next end step" cards. Substantial.

9. **Token database** (SP4 prerequisite) — predefined token registry (Soldier 1/1 W, Treasure, Food, etc.) for `TokenScript$` form.

## Patterns to use (proven this session)

- **Stub-with-precise-gap**: register the handler key with a clear `throw new Error("X deferred to Y because Z")` rather than silent no-op. Semantic validator counts registration; deferral is honest.
- **Group commits per logical batch**: 3-5 effects per commit if they share an architectural pattern.
- **Flagship test FIRST**: write the integration test, then make it pass. Surfaces real gaps faster than unit tests.
- **`game.rng.nextInt(min, max)` is exclusive max** — for d6, use `nextInt(1, 7)`.
- **Replacement registration on resolve**: shields/temporary effects work by registering a `ReplacementAbility` with closure state (`let charges = N; matches() { if (charges <= 0) return false; ... }`). Auto-unregister when consumed.
- **AltCost pattern**: `{ handlerKey, isAvailable(card, game), modifyCastContext(ctx, sa, game) }`. CastProposal.altCostKey selects which one.
- **`activeInZones` on SpellAbility**: default `{Battlefield}`; Cycling-style synthesized abilities use `{Hand}`.

## Pitfalls to avoid

1. **Lexer requires every line to have a `:` prefix** — bare `ALTERNATE` is special-cased. New bare-word lines need explicit handling in the lexer.
2. **`game.cards` Map contains cards in ALL zones** — `*All` effects MUST filter by `card.zone === Battlefield` (or specified Origin$).
3. **`Game.newEntityId()` starts at 1** — synthetic test ids in low range collide. Use `[10_000_001, 20_000_000]` for property-test rawIds.
4. **`exactOptionalPropertyTypes: true`** — passing `undefined` to optional fields fails. Use spread-conditional: `...(value !== undefined ? { value } : {})`.
5. **Biome forbids `!` non-null assertions** — use guards: `if (!x) throw new Error("..."); ...`
6. **Test files need explicit handler imports**: `import "./effects/index.js"` etc., because tree-shaking can drop self-registrations.
7. **`AbilityAst.effect.handlerKey` is the SVar name for triggers/replacements** (e.g. `"TrigDraw"`, `"DBExile"`), NOT a SpellAbilityEffect handler. Resolver only checks DB-prefixed keys for SVar existence.
8. **CastPipeline `ctx.targets` is `unknown[] | undefined`** — must narrow to `EntityId[]`. Existing flagship tests show the pattern.
9. **`game.action.changeLife(seat, delta, opts)` opts shape**: `{cause: string}`, not a string directly.
10. **stack.property test flakiness** — fixed; if it surfaces again, check newEntityId range.

## Key file locations

- Memory: `C:\Users\aleja\.claude\projects\F--BACKUP-Programacion\memory\project_mtg_forge_ts_sp1_execution.md`
- Master spec: `docs/superpowers/specs/2026-04-23-mtg-forge-ts-master-spec.md`
- SP3 spec: `docs/superpowers/specs/2026-04-23-mtg-forge-ts-sp3-dsl-effects-library.md`
- Plans: `docs/superpowers/plans/2026-04-2[3-5]-sp3-part-{a,b,c}-*.md`
- Forge sources: `F:\BACKUP\Programacion\forge\` (read-only)
- Vendored cards: `F:\BACKUP\Programacion\forge\forge-gui\res\cardsfolder\`
- Corpus scanner: `cd tools/dsl-validator && pnpm scan` → coverage report
- Flagship tests: `packages/game/test/flagship/*.test.ts` (18+ cards)

## Suggested kickoff for next session

```
Continue mtg-forge-ts. Read the memory file at C:\Users\aleja\.claude\projects\F--BACKUP-Programacion\memory\project_mtg_forge_ts_sp1_execution.md and the handoff at docs/superpowers/plans/2026-04-26-sp3-quality-waves-handoff.md for full context. Working tree is clean on sp1-engine-foundations at HEAD 2de1a07; 2701 tests; 18+ flagship cards work E2E.

Per the user's binary directive, focus on REAL implementations not coverage stubs. Top-priority next moves (in order):
1. Cost adjustments runtime — RaiseCost/ReduceCost/SetCost statics consulted by mana solver
2. Madness alt-cost (analogous to Flashback)
3. Activated-ability targets (Lightning Greaves equip pattern)
4. Layer 6 keyword-grant EOT cleanup (onExpiry callback)
5. Verify AbilityActivated event makes SpellCastTrigger/AbilityCastTrigger fire correctly

Use subagent-driven-development pattern (proven this session): batch dispatch, ultrathink, TDD per task, group commits per logical batch. After each wave, run `cd tools/dsl-validator && pnpm scan` to verify no regression in coverage AND `pnpm typecheck && pnpm test && pnpm build && pnpm lint` for full gate.

Stay on sp1-engine-foundations, DCO-signed (`git commit -s`), NO `Co-Authored-By` lines, never push.
```

## Final session totals (2026-04-23 → 2026-04-26)

- **172 commits** committed across 4 calendar days
- **2701 tests** passing (+857 from session start)
- **18+ flagship cards** genuinely playable end-to-end
- **5 quality waves** post-coverage push
- **Zero broken gates**
- **Zero `Co-Authored-By`** lines (per user directive)
- **Zero pushes** to remote (per user directive)
