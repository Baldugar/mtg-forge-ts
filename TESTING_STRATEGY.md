# Testing Strategy — mtg-forge-ts

> **Status:** Port complete (Wave 118, HEAD `b06937a`). 4,860 unit/integration tests passing. 100% corpus parser+registration. ~99% functional fidelity by our internal metrics — but **not validated against Forge's Java runtime**. This doc plans the next testing phase.

---

## The gap we need to close

We claim ~99% functional fidelity. That claim is built on:
- 4,860 unit tests passing (handler-level + integration scenarios)
- 100% parser + handler registration coverage on the 32,300-card corpus
- Every static mode wired
- Every TODO(advanced) closed

**But:** those tests verify our implementation matches our understanding of Forge. They don't verify our outputs match Forge's actual outputs on the same inputs. The remaining ~1% gap might be 1% — or it might be 30% on edge cases we haven't enumerated.

**Goal of this phase:** ground our fidelity claim in observed parity against the Java reference.

---

## Testing layers

### Layer 0 — Existing unit + integration tests (DONE)

- **What:** 4,860 tests in `packages/game/test/`, `packages/core/test/`, etc.
- **What it covers:** handler-by-handler correctness against our spec.
- **What it doesn't cover:** end-to-end card resolution against Forge's Java engine.
- **Action:** keep maintaining these as regression coverage.

### Layer 1 — Corpus smoke tests (TODO)

For each of the 32,300 corpus cards, verify the engine can:
1. Parse the card data file without errors.
2. Register all keywords / triggers / replacements / statics.
3. Resolve a "stub cast" without throwing — put the card on the stack, resolve, observe the destination zone.

This is the cheapest end-to-end smoke test. It catches:
- Parser regressions
- Missing handler keys
- Resolver crashes on real card text

**Implementation:** extend `tools/dsl-validator` with a `--smoke` mode that loads each card, casts it via a deterministic test harness, asserts no thrown errors.

**Estimate:** ~1-2 days of work. Coverage check that already-existing infrastructure handles every card.

### Layer 2 — Golden trace tests (TODO)

For a curated set of ~200 representative cards (one per mechanic), capture a deterministic event-trace from an automated cast → resolve → cleanup cycle. Lock the trace as a golden file. Future runs assert no drift.

This catches:
- Subtle behavioral regressions
- Event ordering changes
- Layer-engine recompute timing

**Implementation:** test harness in `packages/game/test/golden/` that runs each card through a fixed seed + scripted opponent, dumps the event log, diffs against `<card-name>.golden.json`.

**Estimate:** ~1 week to set up infrastructure + curate the 200-card set + lock initial goldens.

### Layer 3 — Java parity tests (TODO — THIS IS THE BIG ONE)

For each card, run the same scenario in **both** our TS engine and Forge's Java engine; compare the outputs.

This is the gold standard for fidelity validation. It catches everything Layer 2 catches **plus** anywhere our spec-interpretation diverges from Forge's actual behavior.

**This requires the Java wrapper. See next section.**

### Layer 4 — Game-loop fuzz tests (FUTURE)

Drive entire games to completion via `RandomLegalController` (already used by Subgame). Run thousands of games at fuzzed seeds; assert:
- No engine crashes
- All games terminate
- SBA invariants hold (no negative life pre-loss-check, no creatures with toughness ≤0 surviving, etc.)
- Snapshot/restore round-trips at every priority window

**Implementation:** test harness `packages/game/test/fuzz/` that runs 10k games per seed range nightly.

### Layer 5 — Performance tests (FUTURE)

Per-game memory + time budgets:
- Setup: < 100ms
- Average turn: < 50ms
- 10-turn game: < 5s, < 100MB heap

Catches accidental quadratic blowups in layer recompute or replacement registry walks.

---

## The Java wrapper — design options

The big decision: **how do we run Forge's Java engine programmatically from our test harness?**

### Option A: Subprocess + CLI

- Run Forge's CLI / headless mode as a subprocess (it has one for AI vs AI testing).
- Pass game scenarios via JSON + replay file format Forge already supports.
- Capture Forge's structured log output, parse into events, diff against TS.

**Pros:**
- No JVM-in-Node integration complexity.
- Forge's CLI already exists and is maintained upstream.
- Test isolation per scenario — JVM crashes don't take down the test runner.

**Cons:**
- Slow per-test startup (JVM cold-start).
- Forge's log format may not be deterministic enough for diffing.
- Parsing Forge's text logs is brittle.

**Estimate:** 2-3 days to wire up + script log parser.

### Option B: GraalVM polyglot

- Compile Forge's Java to GraalVM-compatible bytecode.
- Run Forge's classes from Node.js via `@graalvm/js-java`.
- Direct method calls, structured returns.

**Pros:**
- Fastest per-test (in-process JVM).
- Direct access to Forge's internal state for richer comparisons.
- Type-safe interop.

**Cons:**
- GraalVM is a heavy dependency.
- Forge wasn't designed for embedded use; native dependencies might not work.
- Setup complexity is high.

**Estimate:** 1-2 weeks to set up + debug native-dependency issues.

### Option C: HTTP/WebSocket server

- Build a thin Java HTTP server that wraps Forge's Game class.
- Endpoints: `POST /game/new`, `POST /game/{id}/cast`, `GET /game/{id}/state`.
- TS test harness drives the server via fetch.

**Pros:**
- Clean network boundary — easy to debug.
- Server can run remotely (CI parallelism).
- Reusable for non-test purposes (e.g. a future web UI sharing the engine).

**Cons:**
- Need to design + maintain the HTTP API.
- Network round-trip per action — slow for fuzz tests.
- Serialization overhead.

**Estimate:** 3-5 days for server + minimal API + TS client.

### Option D: Replay capture + offline diff

- Don't run Java during test. Instead:
  1. **Capture phase:** instrument Forge to dump scenario→trace pairs into `.golden.java.json` files for our 200-card test set.
  2. **Compare phase:** TS test reads the golden, runs the same scenario, diffs the trace.

**Pros:**
- TS tests run fast (no JVM at test time).
- Capture is one-time per card (until Forge changes).
- CI doesn't need a JVM.

**Cons:**
- Capture phase still needs Java integration of some kind (Option A or B used once to seed the goldens).
- Goldens stale if Forge updates.
- Doesn't catch new card releases until we re-capture.

**Estimate:** 2-3 days for capture script (riding on Option A) + tests that read goldens.

### Recommended path

**Phase 1 (week 1):** Option A (subprocess). Get any parity signal flowing. Use it to validate the 200 most-played cards.

**Phase 2 (week 2-3):** Option D (golden capture). Use Phase 1's subprocess infrastructure to seed `.golden.java.json` files for the curated set. Tests then run goldens-only — fast and CI-friendly.

**Phase 3 (week 4+):** Expand goldens to ~2000 cards covering every mechanic. Re-capture quarterly when Forge updates.

**Defer:** Options B and C until we have a clear use case beyond testing.

---

## Test cohort design

When picking the curated set for golden capture, prioritize:

### Tier 1: Mechanic representatives (~150 cards)
One card per major mechanic, picked for fame + simplicity:
- **Vanilla:** Grizzly Bears, Lightning Bolt
- **Keyword:** Serra Angel (flying/vigilance), Llanowar Elves (mana ability)
- **Triggered:** Bonecrusher Giant (Adventure + ETB), Eldrazi Conscription
- **Activated:** Llanowar Elves (T:Add G), Birds of Paradise
- **Replacement:** Doubling Season, Anointed Procession, Rest in Peace, Leyline of the Void
- **Static:** Glorious Anthem, Worship, Sulfuric Vortex, Solemnity
- **Cost-shenanigans:** Cogwork Spy (Cipher), Worldspine Wurm (Suspend), Karn Liberated (RestartGame)
- **Combat:** Mentor (Tajic), Provoke (Wojek Halberdiers), Decayed (Crawling Infestation)
- **Zone:** Companion (Lurrus), Suspend (Lotus Bloom), Splice (Glacial Ray), Cipher (Stolen Identity)
- **Saga / Class / Battle / Adventure:** History of Benalia, Enthusiastic Mechanaut, Invasion of Ikoria, Bonecrusher Giant
- One per Wave 60-118 closure to validate each handler

### Tier 2: Edge cases (~50 cards)
Cards known to be tricky historically:
- Phantasmal Image (Clone variants)
- Gilded Drake (control swap)
- Worldgorger Dragon (infinite combo enabler)
- Painter's Servant (CDA + colorless damage source)
- Krark's Thumb + Krark's Other Thumb (FlipCoinMod stacking)
- Humility (mass keyword removal Layer 6)
- Shahrazad (subgame)

### Tier 3: Recent / complex prints (TBD)
Recent cards from MKM, OTJ, MH3, Bloomburrow, Foundations, Duskmourn, etc.

**Total Tier 1 + 2:** ~200 cards. Tier 3 expansion lands as needed.

---

## Test infrastructure to build

### TS-side (1-2 weeks)

1. **`packages/game/test/golden/runner.ts`** — generic golden-trace test runner.
2. **`packages/game/test/golden/scenarios/`** — one `.json` per card with scenario spec (life totals, hands, cast sequence).
3. **`packages/game/test/golden/__golden__/`** — captured golden traces (TS engine's output).
4. **`packages/game/test/parity/runner.ts`** — diff TS golden vs Java golden.
5. **`packages/game/test/parity/__java__/`** — captured Java golden traces.

### Java-side (2-3 days)

1. **`tools/forge-bridge/`** — new directory.
2. **`tools/forge-bridge/build.gradle`** — Gradle config pulling in Forge as a dependency.
3. **`tools/forge-bridge/src/main/java/.../BridgeRunner.java`** — main class:
   - Read scenario JSON from stdin (or file).
   - Build a Forge `Game` instance from it.
   - Drive deterministic AI (Forge has `RandomAi`).
   - Dump event-trace JSON to stdout (or file).
4. **CLI:** `java -jar forge-bridge.jar < scenario.json > trace.json`.
5. **Build artifact:** committed `.jar` or built on-demand in CI.

### Trace format (JSON, shared)

```json
{
  "scenarioId": "lightning-bolt-target-creature",
  "seed": 42,
  "engineVersion": "ts-0.1.0" | "forge-0.27.0",
  "events": [
    {"kind": "GameStarted", "version": 1, ...},
    {"kind": "CardCast", "version": 1, "cardId": 1, ...},
    ...
  ],
  "finalState": {
    "winner": "p2",
    "lifeTotals": [0, 17],
    "battlefield": [...]
  }
}
```

The `events` array is the canonical comparison unit. Diffing logic:
- Allow event-id renaming (TS and Java number entities differently).
- Compare event payloads structurally.
- Ignore engine-internal events (e.g. our `EngineYield` decisions).
- Highlight first-divergence with context.

---

## Roadmap + milestones

### Milestone 1: Corpus smoke (1-2 days)
- Extend `tools/dsl-validator` with `--smoke` mode.
- Cast every corpus card via stub harness; assert no errors.
- Lock as CI gate.
- **Outcome:** confirms parser + registration is genuinely 100%, not just registration-clean.

### Milestone 2: Golden infrastructure (1 week)
- Build TS-side golden runner + scenario format.
- Curate 200-card test cohort (Tier 1 + 2).
- Capture initial TS goldens.
- **Outcome:** 200-card regression net for the TS engine.

### Milestone 3: Java bridge MVP (3-5 days)
- Wire up Forge as a Java subproject.
- Build BridgeRunner CLI taking scenario JSON.
- Capture Java goldens for the 200-card cohort.
- **Outcome:** parity baseline established.

### Milestone 4: Parity harness (3-5 days)
- TS-side test runner that diffs TS goldens vs Java goldens.
- Failure-classification tooling (which event-kinds diverge most often?).
- **Outcome:** measurable parity score per mechanic.

### Milestone 5: Fix-the-divergences sprint (1-2 weeks)
- For each parity failure: classify, root-cause, fix.
- Some will be Forge bugs we shouldn't replicate (audit + decide).
- Some will be ambiguous CR interpretations (document the decision).
- **Outcome:** parity score → 99%+.

### Milestone 6: Expand to 2000 cards (2-3 weeks)
- Tier 3: top-2000-most-played cards across formats.
- Capture goldens, run parity, fix divergences.
- **Outcome:** validated fidelity on the cards real players use.

### Milestone 7: Fuzz + performance (FUTURE)
- Random-game fuzz harness.
- Per-game perf budgets.
- **Outcome:** stability + performance baseline.

**Total estimated effort to validated parity:** 4-6 weeks of focused work.

---

## Open questions

1. **Forge version pinning.** Forge upstream changes constantly. Do we pin a specific Forge release as "the reference," or track HEAD? Recommend: pin a release, capture goldens against it, re-pin every 6 months.

2. **Decision schema parity.** Our decision request kinds may not 1:1 match Forge's. Some Forge decisions are inline GUI prompts; ours are explicit yields. The diff harness needs to normalize both sides into a comparable canonical form.

3. **Determinism in Forge.** Forge's RandomAi has a seed slot — verify it's actually deterministic across releases.

4. **Cards that depend on other cards** (Companion, Wishes, Splice). Need a "deck-context" facet of the scenario JSON — not just "cast this card", but "with this hand, this library, this graveyard, this sideboard."

5. **CI runtime budget.** 200-card golden suite × ~1s per Java run = ~3-4 min. 2000-card × 1s = ~30-40 min. Acceptable for nightly; might be too slow for per-PR. Consider sharding.

6. **What about cards Forge can't run?** Forge has its own bug list. Our parity tests will surface those — we should not try to replicate Forge bugs. Need a `KNOWN_FORGE_BUGS.md` or similar.

---

## Recommendation for next session

**Start with Milestone 1 (corpus smoke).** It's the cheapest signal and validates our 100% parser-clean claim. ~1-2 days, all in TypeScript, no Java needed yet.

**Then commit to Milestone 2 + 3 in parallel.** TS-side golden infra + Java bridge MVP can be developed independently.

By end of week 4 we should have a parity score + a fix list. Functional fidelity by observation, not just by self-report.
