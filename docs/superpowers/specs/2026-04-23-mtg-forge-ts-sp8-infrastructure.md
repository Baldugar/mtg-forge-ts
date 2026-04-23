# SP8 — Testing, Release, CI, Licensing, Docs Infrastructure

**Status:** Design approved
**Date:** 2026-04-23
**Location:** Cross-cutting; tools in `tools/`, workflows in `.github/workflows/`, docs in `docs/`
**Prerequisites:** Runs in parallel with all other sub-projects

---

## Purpose

The cross-cutting operational sub-project. Consolidates testing layers, configures CI, manages releases, enforces license hygiene, and maintains consumer-facing documentation. SP8 is not a separate package; it's the infrastructure that supports every other sub-project.

## 1. Testing architecture — six layers

All layers run in CI. Test philosophy: fail loud, fail fast, determinism required, coverage is aggregate (every handler class has ≥ one fixture; every invariant has ≥ one property test).

| Layer | What it tests | Cadence | Tool |
|---|---|---|---|
| **Unit** | One class, isolated. Covers subsystems + all 423 handlers + parsers. Colocated (`X.ts` + `X.test.ts`). | Every commit | vitest |
| **Fixture** | One handler / one scenario, scripted game, asserted final state or key events. ~1000+ fixtures in `tests/fixtures/`. | Every commit | vitest |
| **Parse-every-file** | All 32k vendored cards parse without error. | Every commit | vitest |
| **Cache round-trip** | `export → import → equal` for every card. | Every commit | vitest |
| **Property** | Invariants hold for any game state (no damaged-dead-creature after SBA, mana pool empties, stack LIFO, etc.). | Every commit | fast-check |
| **Golden-master** | Same scenario driven through Java Forge and our TS port; final state diffed. | Nightly + release gate | SP0 harness |
| **AI win-rate** | TS-AI vs TS-AI and vs Forge-AI match-up suite; win rates within tolerance. | Nightly + release gate | Custom harness |
| **Benchmark** | Per-decision latency, clone time, parse throughput. | Nightly + release gate | mitata |

## 2. Unit + fixture organization

```
packages/<pkg>/src/<subsystem>/XFoo.ts
packages/<pkg>/src/<subsystem>/XFoo.test.ts    # colocated unit tests

tests/fixtures/
├── effects/             # per-effect fixtures, 3-5 scenarios each
├── triggers/
├── replacements/
├── keywords/
├── flagship-cards/      # integration tests for ~30-50 high-value cards
├── combat/              # combat scenarios
├── commander/
├── multiplayer/         # N > 2 player scenarios
└── draft/               # SP7 fixture scenarios
```

Each fixture: initial state + scripted decisions + expected events / final state. Readable as a test case.

## 3. Property test suite

`fast-check` generators + assertions:

**Invariants:**
- After SBA sweep: no creature on battlefield with damage ≥ toughness (unless indestructible).
- After priority window boundary: mana pool empty.
- Stack is LIFO.
- Every EntityId unique.
- Every card in exactly one zone (for live cards; tokens-in-graveyard-one-SBA-before-cease OK).
- `snapshot() → restore() → snapshot()` equal.
- Event stream replay reaches same final state as live play.
- Zero-cost spells always castable when priority allows.
- Active trigger's source in its registered-active zone.
- Static effect's source in a zone matching its `activeInZones`.
- Draft snapshot restore equals no-restore continuation.

Generators: decks, seeds, decision logs. Shrinking gives minimal reproducers.

## 4. AI win-rate regression suite

~30 fixture decks per constructed format (aggro / midrange / control / combo / tempo archetypes + classic historical decks). Pinned baselines in `tests/ai/baselines.json`:

```json
{
  "modern/rdw-vs-uw-control/hard": {
    "decks": ["red-deck-wins", "uw-control"],
    "profile": "forge-hard",
    "rdwWinRate": 0.49,
    "tolerance": 0.03,
    "lastUpdated": "2026-04-23"
  }
}
```

Nightly CI runs 200-500 games per matchup; deviation > tolerance fails the build. Baseline update is a human decision tracked in a dedicated PR.

### Parity vs Forge

Periodically (release gate): same matchup run as TS-AI-vs-TS-AI and Forge-AI-vs-Forge-AI (via SP0 harness). Win rates compared; |X - Y| < 5pp is the bar.

## 5. Benchmarks (mitata)

Benchmarks gated in CI. Regressions > 20% fail the build; < 20% warn.

| Benchmark | Target | Notes |
|---|---:|---|
| `GameCopier.clone` | <1ms | Critical AI sim primitive |
| `LayerEngine.compute` single-card | <0.5ms | Typical case; worst case 2ms |
| `SbaEngine.checkAll` 40-permanent board | <2ms | |
| `CardDb.parseAll` full 32k | <30s | Eager load |
| `CardDb.importCache` 32k cards | <20ms | From pre-parsed blob |
| `TriggerRegistry.onEvent` dispatch | <0.1ms avg | |
| `AiController.decidePriority` | per-profile | Profile's declared budget is the cap |

Rolling baselines recorded in `bench/baselines/`. Updated manually on intentional perf changes.

## 6. CI pipeline — GitHub Actions

Workflows in `.github/workflows/`:

### `ci.yaml` (every push / PR)

Fast tests only. Matrix: Node 20 + Node 22 on Linux + macOS + Windows. Target duration <5 minutes.
- `pnpm install`.
- `pnpm run lint` (biome).
- `pnpm run typecheck`.
- `pnpm run test:unit`.
- `pnpm run test:fixture`.
- `pnpm run test:parse`.
- `pnpm run test:property` (light mode: N=10 per invariant, not the nightly N=100).
- `pnpm run test:oracle:smoke` (5-10 scenarios; requires JDK 17).

### `ci-nightly.yaml` (daily cron, 03:00 UTC)

Full battery. Target duration <45 minutes.
- Everything from `ci.yaml`, full N=100 property.
- `pnpm run test:oracle:full` (all 100-200 scenarios).
- `pnpm run test:ai-winrate` (all 30 matchups, 300 games each).
- `pnpm run test:benchmark`.
- Emails / pings maintainer on failure.

### `release.yaml` (on changeset merge to main)

Triggered by changesets' "Version Packages" PR merge.
- Gates on `ci-nightly` equivalent passing.
- `pnpm build` all packages.
- `changesets publish` to npm.
- Tag release.
- Deploy typedoc to GitHub Pages.
- Generate + attach release notes.

### `sync-card-data.yaml` (weekly cron, Monday 03:00 UTC)

- Clones upstream Forge at `main`.
- Runs `tools/sync-upstream/sync-card-data.ts`.
- Structural validator gates the PR.
- Opens `sync: upstream card data` PR if changes.
- Blocked if any unknown handler key detected.

### `sync-engine-triage.yaml` (monthly cron, 1st of month)

- Lists upstream engine commits since last sync.
- Opens triage PR with no code changes.
- Human reviews + ports commits one-by-one.

### `dco-check.yaml` (every PR)

- Verifies every commit has `Signed-off-by:` trailer.
- Fails PR if any commit missing.

### `dependency-audit.yaml` (weekly)

- `pnpm audit` + license compatibility check.
- Fails build if any new dependency is GPL-incompatible.

## 7. Release + versioning

### Changesets

Every PR with user-visible changes adds `.changeset/<name>.md`:

```
---
"@mtg-forge-ts/game": minor
"@mtg-forge-ts/ai": patch
---

Add cascade trigger handler with full CR 702.84 semantics.
```

Merging a changeset-containing PR triggers changesets action, which aggregates into a "Version Packages" PR. Merging that publishes.

### Semver rules

- **Major**: breaking API; breaking `GameSnapshot` format; breaking cache format; breaking event shape without migration.
- **Minor**: additive API; new events; new decision kinds; new handler classes.
- **Patch**: bug fixes; internal refactors; docs; upstream sync without API change.

### Migration policy

- **Patch / minor**: save-compatible. `GameSnapshot` loads.
- **Major**: may require migration. Ship `migrateSnapshot(old, from, to)` function when breaking. Without migration → throw `IncompatibleSnapshotVersionError`.
- **Cache format**: separately versioned (`cacheFormatVersion`). Bumping = major semver. Consumers re-export. Documented in CHANGELOG.

### Three versioning axes

On every `game.meta` and every `GameSnapshot.header`:
- `engineVersion`
- `forgeSha` + `cardDataSyncedAt`
- `crVersion`

## 8. Upstream sync tooling

In `tools/sync-upstream/`:

### `sync-card-data.ts`

Steps:
1. Clone `Card-Forge/forge` at specified tag (or main) to scratch dir.
2. Copy `cardsfolder/`, `blockdata/`, `editions/` into `packages/cards/data/`.
3. Run structural validator over diffed files.
4. Update `SYNCED.json` (SHA, tag, date, crVersion).
5. Generate PR title: `sync: Forge to <sha> (<cards-added> added, <cards-changed> changed)`.
6. If unknown-keyword tokens: PR body includes list of missing handlers; CI fails with `blocked: needs-handler-port`.
7. Open PR via `gh pr create`.

`--dry-run` and `--verbose` flags supported.

### `sync-engine-triage.ts`

Steps:
1. List Forge commits since `SYNCED.json.forgeSha` touching `forge-core/`, `forge-game/`, `forge-ai/`.
2. Classify per commit: touched files, rough category (effects / triggers / combat / AI / other).
3. Summarize into a Markdown table.
4. Open triage PR with title `triage: upstream Forge changes <old-sha>..<new-sha>` containing no code changes, just the table.

### `sync-formats.ts`

Same pattern as `sync-card-data.ts` for format/banlist files.

## 9. Licensing + attribution + DCO

### Per-package hygiene

- `package.json`: `"license": "GPL-3.0-or-later"`.
- Every source file: `// SPDX-License-Identifier: GPL-3.0-or-later` header.

### Repo root

- `LICENSE` — full GPL-3.0 text.
- `NOTICE` — attribution to Card-Forge + last-synced commit SHA + Wizards trademark disclaimer.

Example `NOTICE` content:
```
mtg-forge-ts is a derivative work of Card-Forge/forge (https://github.com/Card-Forge/forge),
licensed under GPL-3.0-or-later.

Last synced from Card-Forge/forge at commit <sha> on <date>.

Magic: The Gathering is a trademark of Wizards of the Coast LLC.
This project is unofficial and not affiliated with or endorsed by Wizards of the Coast.
```

### DCO

Contributor sign-off via `git commit -s`. CI enforces.

`CONTRIBUTING.md` explains: by signing off, you certify you have the right to contribute this under GPL-3.0-or-later, per the [DCO](https://developercertificate.org/).

`.gitmessage` commit template with sign-off prompt.

### Dependency audit

`tools/license-audit.ts` walks `pnpm ls`, verifies each dependency is GPL-compatible:
- Compatible: MIT, BSD, Apache-2.0 (with GPL notice), ISC, MPL, LGPL, GPL-3.0.
- Incompatible: proprietary, unknown, known-GPL-incompatible (Apache-2.0 without notice in GPLv2 contexts — not a concern for us since we're v3+).

Failures in `dependency-audit.yaml`.

## 10. Docs + consumer patterns

### Doc site (`docs/`)

- Generated via typedoc from TSDoc comments.
- Deployed to GitHub Pages on release.
- Organized by package; cross-package examples live in recipes.

### Consumer recipes (`docs/recipes/`)

Tested code examples for common integration patterns:

- **`server-authoritative-multiplayer.md`** — library on server, clients via WebSocket.
- **`electron-local-game.md`** — library in worker, UI in renderer, events for updates.
- **`deckbuilder-card-db-only.md`** — minimal bundle for pure deckbuilder.
- **`stored-pre-parsed-card-db.md`** — Conflux pattern: cron parses + stores, runtime loads from storage.
- **`spectator-view.md`** — unseated player, renders `GameView`.
- **`replay-viewer.md`** — reconstruct from `{snapshot, decisions, events}`, scrub through history.
- **`historical-engine.md`** — Mana and Life pattern: era-specific CardDb + format + banlist + AI profile knowledge-cutoff.
- **`tournament-orchestrator.md`** — Match state + Draft/Sealed events + format validation + scores.

Recipes are **tested** — recipe test scripts run in CI, ensuring examples stay working.

### Reference docs (`docs/reference/`)

- Architecture overview.
- Event catalog (~60 events).
- Decision kind catalog.
- Registry catalog.
- Error catalog.
- Glossary (EntityId, CardDefinition, PaperCard, Card, GameView, etc.).

## 11. Contributing + governance

### `CONTRIBUTING.md`

- Code style: biome enforced.
- DCO sign-off required.
- Commit messages: Conventional Commits (`feat:`, `fix:`, `refactor:`, `test:`, `docs:`, `chore:`, `sync:`, `triage:`).
- PR process: one changeset per user-visible change; one reviewer; CI green.
- Issue tags: `bug`, `enhancement`, `upstream-sync`, `documentation`, `good-first-issue`.
- Contribution scope welcome: handlers, fixtures, documentation, bug fixes. Architecture changes require discussion issue first.

### `CODE_OF_CONDUCT.md`

Standard Contributor Covenant.

### `SECURITY.md`

Private disclosure via email.

### Governance

- Solo maintainer (you) for v1.0.
- Post-v1, as contributors arrive, small maintainers team with explicit decision-making process.

## 12. Cross-cutting conventions (consolidated reference)

One place listing every convention. Violations are bugs.

- **Entity-ID references** only in stored state — no pointers.
- **Class-based Forge-faithful port** — mirror Forge's Java class names where sensible.
- **Generator-based engine** — `function*` / `yield*` in engine mutation paths. No `async`/`Promise` inside engine core.
- **Unified event/decision stream** — one yield channel.
- **Polymorphic types with `kind:` discriminator** for JSON round-trip.
- **Per-event `version: number`** — event shape evolution via semver.
- **`Rng` injected per-game** — no globals; no ambient randomness. Enforced by lint.
- **`GameAction` + `CombatHandler`** are sole mutators of their state domains.
- **`toJSON` / `fromJSON` on every class** that appears in serialized state.
- **Three versioning axes** in `game.meta`: engine, card data, CR.
- **DCO sign-off** on every commit.
- **SPDX headers** on every source file.
- **No emojis** in code or docs unless explicitly requested.
- **Fail loud** with typed errors.
- **Simulation RNG pinned per branch** — matches Forge's approach; parallel sim deferred to post-v1.
- **Lazy by default, eager on demand** — CardDb loading strategy.
- **Data-path resolution via `cards.getDataPath`** — no hardcoded cross-package paths.

## 13. Phases

SP8 runs in parallel with every sub-project. Phases grouped by "when they become needed":

### Early (with SP0 + SP1)

| Phase | Scope |
|---|---|
| **8a** | CI skeleton: `ci.yaml` workflow, biome config, tsconfig.base.json, pnpm workspace config |
| **8b** | License + attribution: LICENSE, NOTICE, SPDX headers, per-package `package.json` license field |
| **8c** | DCO: `dco-check.yaml`, `.gitmessage` template, CONTRIBUTING.md with sign-off section |
| **8d** | Release workflow: changesets config, `release.yaml`, CHANGELOG.md templates |

### Mid (with SP2-SP4)

| Phase | Scope |
|---|---|
| **8e** | `ci-nightly.yaml` with full property tests + SP0 oracle integration |
| **8f** | Benchmark harness + initial baselines + `bench/` directory |
| **8g** | Dependency audit tooling + `dependency-audit.yaml` |
| **8h** | Upstream sync tooling: `sync-card-data.ts`, `sync-formats.ts`, cron workflows |

### Later (with SP5-SP7)

| Phase | Scope |
|---|---|
| **8i** | AI win-rate regression framework + baseline files + nightly integration |
| **8j** | `sync-engine-triage.ts` + monthly cron workflow |
| **8k** | Docs site: typedoc config, GitHub Pages deploy, recipe test harness |
| **8l** | Recipe authoring + testing (8 recipes per section 10) |
| **8m** | Reference docs (event catalog, decision catalog, registry catalog) |

## 14. What SP8 does NOT cover

- Library feature code — sub-projects 0-7.
- Marketing / promotion / community building.
- User-facing UI or apps.
- Tournament organization services.
- ML model hosting.
