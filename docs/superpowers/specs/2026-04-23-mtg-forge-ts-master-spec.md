# mtg-forge-ts — Master Specification

**Status:** Design approved, pending implementation
**Date:** 2026-04-23
**Target repo:** `github.com/Baldugar/mtg-forge-ts`
**Target npm scope:** `@mtg-forge-ts/*`
**License:** GPL-3.0-or-later (derivative of Card-Forge/forge)

---

## 1. Project summary

A TypeScript port of the Forge Magic: The Gathering rules engine, reshaped as a consumable library rather than a GUI application. The port mirrors Forge's architecture class-for-class where reasonable, reuses Forge's vendored card scripts verbatim, and is designed to run on Node.js (with a pluggable loader seam for future browser adapters).

The library provides: the full rules engine, 32,303+ card definitions, all game formats (15 constructed + limited), Forge-equivalent AI, deterministic replay, save/load, and network-authoritative multiplayer capability. It does not ship rendering, asset fetching, network transport, or app-level persistence — those are consumer concerns.

## 2. Goals and non-goals

### Goals

- **Faithful behavior** — match Java Forge's game-state outputs for scripted scenarios to the extent of reasonable implementation parity.
- **Complete coverage** — every card, every effect, every trigger, every replacement, every keyword, every format. No "phase 2" deferrals.
- **Deterministic replay** — `{seed, decisions, events}` reconstructs a game bit-identically.
- **Headless library shape** — programmatic API only; no visuals, no assets.
- **Upstream-syncable** — weekly automated sync of Forge's card data; monthly triage of engine changes.
- **Multi-app usable** — Node/browser-capable via a pluggable loader seam; suitable for server-authoritative and client-embedded patterns alike.

### Non-goals (library responsibility ends here)

- Rendering, animations, card images (library exposes image keys + Scryfall URL builders; actual fetch/cache is the consumer's concern).
- Network transport (library exposes serializable state/events/decisions; wire format is the consumer's concern).
- Persistence (library exposes snapshot/restore; storage layer is the consumer's concern).
- Quest mode / Adventure mode (Forge-specific GUI features; if needed, built on top of the engine).
- AI machine learning (we port Forge's static heuristics; no online learning).

## 3. Downstream consumers

Two apps inform scope:

### The Conflux
Existing Vite frontend + Go backend + ArangoDB. Card catalog and deckbuilder, loaded from Scryfall. Plans to add an AI-play simulator as a Node.js microservice. Uses the library's per-card cache streaming API so the daily card-import cron can store pre-parsed definitions in ArangoDB.

### Mana and Life
Vite project planned as an Electron app with SQLite. Simulates a Magic player's journey from 1993 to present day: every set, every tournament, every metagame shift. The library's historical-date-aware APIs (`getCardsAsOf`, `getLegalSets`, `isLegalAsOf`, era-aware AI profiles) exist specifically for this use case. Engine runs in an Electron worker; UI consumes `GameView` projections and event streams.

## 4. Licensing

This project is a derivative work of [Card-Forge/forge](https://github.com/Card-Forge/forge), licensed under GPL-3.0-or-later (per upstream's `version 3 of the License, or (at your option) any later version` grant).

- Every published package declares `"license": "GPL-3.0-or-later"`.
- Every source file carries `// SPDX-License-Identifier: GPL-3.0-or-later` header.
- Repo root contains `LICENSE` (full GPL-3.0 text) and `NOTICE` (upstream attribution + last-synced SHA + disclaimer + Wizards trademark acknowledgement).
- Contributor DCO: every commit must have `Signed-off-by:` trailer, CI-enforced.
- Dependency license audit runs weekly; GPL-incompatible dependencies are rejected.

Monetization by consuming apps is unrestricted (GPL permits sale); downstream distribution of derivative works must also be GPL-3.0-or-later.

## 5. Package structure

Seven packages in a pnpm monorepo:

| Package | Purpose |
|---|---|
| `@mtg-forge-ts/core` | Types, DSL AST, `Rng`, `GameView`/`PlayerView`/`CardView`, image keys, event and decision type definitions, `FormatDefinition` interface, typed error hierarchy. Zero runtime dependencies. |
| `@mtg-forge-ts/cards` | Vendored Forge card data (87 MB), DSL parser, structural validator, card/token/emblem DB, editions/blocks data, Scryfall URL builders, historical-date helpers. |
| `@mtg-forge-ts/game` | Rules engine: GameAction, phase handler, stack, layer engine, SBAs, trigger/replacement/static registries, combat handler, cast pipeline, match controller, 204+139+46+34+30 handler classes. |
| `@mtg-forge-ts/ai` | Forge-equivalent AI: `PlayerControllerAi`, `AiController`, mana solver, combat AI, creature evaluator, game-tree simulator, 204 per-effect AI classes, difficulty profiles, deck-building. |
| `@mtg-forge-ts/formats` | 15 formats, banlist history, rotation logic, deck validation, Commander color identity, rule override registration. |
| `@mtg-forge-ts/limited` | Booster generation, Sealed/Jumpstart/Prerelease orchestration, Draft orchestration and 9 variants, draft bots, sealed deck-builder bot, cube support. |
| `@mtg-forge-ts/engine` | Meta-package depending on all the above. Convenience install. |

### Dependency graph

```
core  ←──  cards
  ↑          ↑
  │          │
  └── game ──┤        ai ←── game ←── cards ←── core
       ↑     │                                    │
       │     │       formats ──────────────────── ┤
       │     │                                    │
       │     │       limited ←── formats ←── ai ──┘
       │     │                                    
engine ─────┴─────────── depends on all the above
```

Nothing in `core` or `cards` depends on `game`. `game` never depends on `ai`. `ai` and `formats` can be imported independently by consumers who only need one. `limited` assumes the full stack.

## 6. Sub-project decomposition

All work committed; no deferrals. Sub-projects sequenced so each can begin once its prerequisites ship.

| # | Sub-project | Owns (packages) | Spec |
|---|---|---|---|
| **SP0** | Golden-Master Oracle Harness | tools/ | [sp0-golden-master-oracle.md](2026-04-23-mtg-forge-ts-sp0-golden-master-oracle.md) |
| **SP1** | Engine Foundations | core + game (scaffold) | [sp1-engine-foundations.md](2026-04-23-mtg-forge-ts-sp1-engine-foundations.md) |
| **SP2** | Rules Systems | game | [sp2-rules-systems.md](2026-04-23-mtg-forge-ts-sp2-rules-systems.md) |
| **SP3** | DSL + Effects Library | game + cards (parser) | [sp3-dsl-effects-library.md](2026-04-23-mtg-forge-ts-sp3-dsl-effects-library.md) |
| **SP4** | Card Database | cards | [sp4-card-database.md](2026-04-23-mtg-forge-ts-sp4-card-database.md) |
| **SP5** | AI Engine | ai | [sp5-ai-engine.md](2026-04-23-mtg-forge-ts-sp5-ai-engine.md) |
| **SP6** | Formats & Legality | formats | [sp6-formats-legality.md](2026-04-23-mtg-forge-ts-sp6-formats-legality.md) |
| **SP7** | Limited | limited | [sp7-limited.md](2026-04-23-mtg-forge-ts-sp7-limited.md) |
| **SP8** | Testing, CI, Release, Docs Infrastructure | (cross-cutting) | [sp8-infrastructure.md](2026-04-23-mtg-forge-ts-sp8-infrastructure.md) |

SP0 and SP8 are cross-cutting; they begin early and continue throughout. SP1 unblocks everything. SP4a (vendoring script) unblocks SP0's Java harness (which needs card data to run Forge). SP3 and SP4 progress in lockstep (parser + data). SP5 begins once SP2/SP3 produce a playable engine. SP6 and SP7 layer on top.

## 7. Cross-cutting conventions

Applied uniformly across every package. Implementations that violate these are considered bugs.

### Architecture

- **Class-based Forge-faithful port** — mirror Forge's Java class names where sensible. Contributors familiar with Forge read the code and recognize the shape.
- **Entity-ID references** in stored state only — no pointer cycles. Every distinct entity (Card, Player, StackItem, Token, DelayedTrigger) gets a monotonic numeric `EntityId`.
- **Generator-based engine** — `function*` / `yield*` throughout engine mutation paths. No `Promise` or `async` inside the engine core. Generators yield `{kind: "decision", ...}` or `{kind: "event", ...}` items to the outer driver.
- **Unified event/decision stream** — single yield channel, not parallel callback buses. Simplifies buffering/rollback and matches the replay model exactly.
- **Three mutators** — `GameAction` owns card/player/zone/counter/stack state mutation. `CombatHandler` owns `CombatState` mutation. Subsystems own their own registry bookkeeping. Everything else is read-only.
- **Polymorphic serialization with `kind:` discriminator** — every polymorphic type's JSON form carries a `kind` field; `fromJSON` dispatches on `kind` to instantiate the correct subclass.

### Determinism

- **`Rng` injected per-`Game`** — never global, never static. No `Math.random()`, no `Date.now()`, no `new Date()`, no `crypto.randomUUID()` inside `@mtg-forge-ts/game` or `@mtg-forge-ts/ai`. Lint rule enforces.
- **Sim RNG pinning** — simulation clones pin a single `branchSeed` across all branches (ported from Forge's `SpellAbilityPicker.evaluateSa` approach). Real game RNG never advances during simulation.
- **Stable iteration order** — `Map` and `Set` are fine (insertion-ordered since ES2015). Sort by `EntityId` ascending when iteration order would affect output.

### Error handling

- **Fail loud with typed errors.** `@mtg-forge-ts/core/errors` defines the hierarchy (`ForgeError` → `UnknownCardError`, `IllegalDecisionError`, `GameStateIntegrityError`, etc.). Consumers catch at boundaries.
- **No silent fail-soft.** Any invariant violation throws.

### Controllers

Three controller interfaces, each with its own decision taxonomy:
- **`PlayerController`** (22 decision kinds) — per-game, per-seat. Casting, targeting, combat, mulligan, priority, etc.
- **`DraftPlayerController`** (~7 decision kinds) — per-draft, per-seat. Picking cards, variant-specific choices (pick, jumpstartPick, winstonPile, solomonSplit, gridPick, rochesterPick, draftMulligan).
- **`MatchController`** (~3 decision kinds) — per-match, per-seat. Sideboarding between games, concede-match, accept-draw.

Consumer apps may implement any/all of these with one class.

### Versioning

Three axes, all exposed on `game.meta`:
- **Engine semver** — library version per changesets release cycle.
- **Card data SHA + sync date** — last upstream Forge commit we synced card data from.
- **CR version** — Comprehensive Rules publication date targeted.

`GameSnapshot` and `DraftSnapshot` headers include all three; on restore, version mismatches surface warnings.

### Package layout conventions

- Each package: `src/`, `test/`, `package.json`, `tsconfig.json`, `README.md`, `LICENSE` (symlink or copy), `CHANGELOG.md`.
- `src/` subdirectories grouped by concern, flat by default (no arbitrary nesting).
- Handler classes one-per-file; categorization in code comments only.
- Tests colocated for unit tests (`X.ts` + `X.test.ts`); fixture tests in `test/fixtures/`.

### Testing

Six layers, runs in CI:
1. Unit (colocated).
2. Fixture (per-handler, scripted scenarios).
3. Parse-every-file (32k cards).
4. Cache round-trip.
5. Property (fast-check invariants).
6. Golden-master (SP0 oracle vs Java Forge).
7. AI win-rate regression (vs pinned baselines + parity vs Forge).
8. Benchmarks (mitata, fail CI if regression >20%).

See SP8 for details.

### Build + publish

- Node 20 LTS minimum; also tested on 22. Browser adapter deferred (loader-seam in place).
- TypeScript strict (+ `noUncheckedIndexedAccess`, `noImplicitOverride`, `exactOptionalPropertyTypes`).
- `tsup` bundler per package (dual ESM+CJS).
- `pnpm` workspaces.
- `vitest` for tests.
- `fast-check` for properties.
- `biome` for lint+format (single tool).
- `changesets` for multi-package versioning.
- `typedoc` for API docs → GitHub Pages.
- `mitata` for benchmarks.
- `lefthook` for commit hooks (biome on staged files, DCO check).

## 8. Cross-cutting state-preservation mechanisms

Three separate mechanisms, each serving its own purpose (ported from Forge's separation):

| Mechanism | Purpose | Used by |
|---|---|---|
| **Distributed undo** | Cast-abort / activation-abort rollback. Each tentatively-mutating class exposes `undo()`. | `CastPipeline`, `CostPayment`, `ManaRefundService`, `CombatHandler` |
| **`GameSnapshot`** | User-visible save/load. Full JSON serialize/restore. | Application save slots, checkpoint debugging |
| **`GameCopier`** | AI simulation deep-clone. Target <1ms. | `AiController` sim path only |

## 9. Registries

Consolidated list of all registries across packages. Each follows the same shape: `register(item)`, `get(key)`, `list()`, `remove(key)`.

**In `game`:**
- `EffectRegistry` — 204 `SpellAbilityEffect` classes keyed by handler key.
- `TriggerRegistry` — runtime active triggers + 139 handler types.
- `ReplacementRegistry` — runtime active replacements + 46 handler types.
- `StaticEffectRegistry` — active static effects.
- `KeywordRegistry` — 34 keyword handler classes.
- `CostPartRegistry` — ~30 cost part types.
- `AltCostRegistry` — alternative-cost mechanics (Flashback, Madness, etc.).
- `RuleOverrideRegistry` — format-specified rule overrides (commander damage, commander zone replacement, etc.).

**In `formats`:**
- `FormatRegistry` — 15 default formats + custom-registered.

**In `ai`:**
- `AiProfileRegistry` — per-instance, created at `PlayerControllerAi` construction.
- `SpellApiToAi` — 204 `SpellAbilityAi` classes, dispatched by effect kind.
- `SpecialCardAiRegistry` — per-card AI overrides for ~100-200 famous cards.

**In `cards`:**
- `CardDb` — card definition lookup.
- `TokenDb` — predefined token templates.
- `EmblemDb` — predefined emblem templates.

**In `limited`:**
- `CubeRegistry` — user-registered cubes.
- `JumpstartThemeRegistry` — predefined half-decks.
- `DraftTriggerRegistry` — Conspiracy draft-matters card abilities.

## 10. Data sourcing and upstream sync

Card data, editions, blockdata, format data, AI profiles: all vendored from `Card-Forge/forge` into `packages/cards/data/` (~87 MB). `SYNCED.json` records the upstream SHA + sync date.

Automation:
- **Weekly cron** `sync-card-data.ts` — pulls upstream, runs structural validator, opens PR. Blocked by unknown-handler-key gate.
- **Monthly cron** `sync-engine-triage.ts` — lists upstream engine commits since last sync, opens triage PR (no code changes; human reviews + ports manually).
- **Weekly** `sync-formats.ts` — pulls upstream format/banlist changes.
- **Quarterly manual** — CR version bump.

See SP8 for workflow details.

## 11. Deferred follow-up work

Explicitly named, committed, scheduled for post-v1.0:

### Tournament-tier AI profiles (for Mana and Life)

Baseline profiles (`forge-easy`, `forge-medium`, `forge-hard`) ship with v1.0. Additional tournament-tier profiles — FNM tier 1/2, Regional baseline, Grand Prix per-archetype, Pro Tour specialization, Worlds champion — are post-v1 work. Reason: each profile requires dedicated calibration against its intended peer-level win rate, downstream of having the full engine and baseline AI stable.

Architecture in SP5 (`AiProfileRegistry`, override hooks, knowledge-cutoff filter) is designed as a first-class extensibility surface. Consumers register custom profiles via `AiProfileRegistry.register()`; no library changes required to add tournament tiers.

### Browser adapter

Node-first v1.0. Loader seam (`CardScriptLoader` interface) placed so a `BrowserFetchLoader` or `BundledLoader` can be written later without changing engine code. Browser-adapter work is its own future sub-project.

### Post-v1 performance optimization

AI simulation cloning targets <1ms per clone (see SP5 §15 benchmarks). If benchmarks fail this on hard profiles, optimize `GameCopier` — potentially via allocation pooling or custom binary cloning. Not pre-optimized; measure first.

### Parallel simulation

Instance-scoped `Rng` means per-game simulations can parallelize across worker threads without the global-RNG contention Forge suffers. v1.0 ships single-threaded sim; parallel-sim is a post-v1 optimization.

## 12. Roadmap

Ordering is logical, not strict calendar dates. Each sub-project gets its own implementation plan authored after this master spec is approved.

1. **SP0a-b + SP1** begin in parallel. SP1 unblocks everything downstream; SP0's Java harness needs SP4a's vendored data.
2. **SP4a** (vendoring script) runs early — produces the card data dump SP0 and SP3 both need.
3. **SP2** begins once SP1 scaffolding exists. Rules systems implementation is the longest single workstream.
4. **SP3** begins as SP2 produces the runtime scaffolding for handlers. Initial focus on the most-common 50 effect handlers so end-to-end games become playable early with the `RandomLegalController`.
5. **SP4** (full card database) continues incrementally. `parseAll` over the full 32k validates SP3's handler coverage.
6. **SP5** begins once a playable engine exists. AI work is long (204 per-effect classes).
7. **SP6** and **SP7** layer on top of a working engine; can proceed in parallel with SP5's later phases.
8. **SP8** is continuous throughout.

Rough size estimate: SP1-SP4 is the foundation (~4-6 months solo); SP5 is the biggest single task (~3-4 months solo); SP6-SP7 is moderate (~1-2 months). Plus ongoing SP0/SP8. Expect v1.0 at 9-15 months of consistent solo effort, faster with Claude's assistance on mechanical porting.

## 13. Known limits and open questions

**Known limits:**
- GPL-3.0-or-later means any Electron app or client-distributable that embeds the library must also be GPL-3.0-or-later. Server-only use (network access to a GPL-3.0 service) is unrestricted.
- Localization of card rules text: not supported (engine uses English canonical rules). Card names accessible; translations are a consumer concern.
- Multiplayer network transport: not shipped. Library exposes serializable state and events; transport is consumer.
- Card images: not shipped. Library exposes Scryfall URL builders; fetch and cache is consumer.

**No open questions as of this spec's freeze date.** All design decisions are locked. Any discovered during implementation will be treated as bugs or follow-up RFCs against a frozen baseline.

## 14. How to read this spec

1. **Start here** (master spec) for overall architecture and conventions.
2. **Read the sub-project spec** for the area you're implementing.
3. **Consult the implementation plan** (to be authored per sub-project via `superpowers:writing-plans`) for step-by-step work.

Specs are intentionally concept-first; plans are step-first.
