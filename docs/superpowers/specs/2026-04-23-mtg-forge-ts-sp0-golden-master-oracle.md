# SP0 — Golden-Master Oracle Harness

**Status:** Design approved
**Date:** 2026-04-23
**Package:** `tools/golden-master-oracle/` (not a published package)
**Prerequisites:** SP4a (vendored card data) for Java Forge to run

---

## Purpose

Use the Java Forge codebase as an infinite-scale correctness oracle for our TypeScript port. Given a scripted scenario (decks + seed + decision log), run the same scenario through Java Forge and our TS port, serialize the resulting game states to a canonical JSON shape, canonicalize entity IDs, and diff. Any unexplained divergence is a port bug.

Without this oracle, "the 32k cards work correctly" is an unprovable claim. Hand-writing fixtures for every card is infeasible. The oracle is the only scalable correctness check we have.

## Architecture

Four components, each independently testable.

### Component 1: Java harness (`tools/golden-master-oracle/java/`)

A small Java CLI that wraps Java Forge in headless mode:

- Consumes a scenario file on stdin (or `--scenario <path>`).
- Loads the scenario's decks using Forge's `DeckSerializer` equivalent.
- Constructs `Game` with the scenario's specified format, seed, and rules overrides.
- Implements a `PlayerControllerScripted` that reads the scripted decision log sequentially.
- Drives the game until terminal state, rollback, or scenario completion.
- Serializes the final game state to the canonical JSON shape (Component 2).
- Emits to stdout.

Distribution: a runnable fat JAR produced via Maven Shade Plugin. CI pulls a pinned version.

### Component 2: Canonical state format (`tools/golden-master-oracle/schema/`)

A JSON Schema describing what "a game state snapshot" looks like for diffing purposes. Both Java harness and our TS port serialize to this exact shape.

Top-level shape:

```json
{
  "schemaVersion": 1,
  "forgeSha": "abc123...",
  "turn": 5,
  "phase": "PreCombatMain",
  "activePlayer": 0,
  "priorityPlayer": 0,
  "stack": [ /* StackItem[] */ ],
  "players": [ /* Player[] with zones, life, counters, mana */ ],
  "continuousEffects": [ /* sorted by timestamp asc */ ],
  "pendingTriggers": [ /* sorted by (player, trigger id) */ ],
  "flags": { /* day/night, monarch, initiative, etc. */ },
  "combat": null | { /* CombatState */ },
  "terminalState": null | { "winner": 0, "reason": "lifeZero" }
}
```

The full schema covers every serializable state field with strict types. Fields are ordered alphabetically within objects for stable serialization. Arrays ordered by canonical sort keys (see Component 3).

### Component 3: Entity-ID canonicalization

Java Forge and our TS port assign `EntityId`s independently during scenario execution. Raw ID values will always differ. We diff **structurally**, not by raw ID.

Pre-diff canonicalization pass:

1. Walk every entity in the state tree.
2. For each entity, compute a canonical key:
   - Cards: `(zone, owner, definition_name, index_in_zone)`.
   - Players: `seat`.
   - Stack items: `(stack_position, source_card_canonical_key)`.
   - Delayed triggers: `(source_card_canonical_key, creation_turn, trigger_kind)`.
   - Tokens: `(zone, controller, owner, template_name, creation_timestamp_order)`.
3. Sort entities by canonical key.
4. Assign new IDs in sorted order (0, 1, 2, …).
5. Rewrite all ID references in the state tree using the new IDs.

Result: two states that were "the same game state with different IDs" become byte-identical JSON.

Canonical key ambiguity (e.g. two tokens created in the same turn with the same template) broken by creation order. If creation order genuinely differs between Forge and our port, that's a divergence worth flagging.

### Component 4: TS runner (`tools/golden-master-oracle/runner.ts`)

Node.js test harness. Per scenario:

1. Parse scenario YAML/JSON.
2. Start Java harness via `child_process.spawn`, pipe scenario in, capture stdout.
3. Drive our TS port with the same scripted decisions.
4. Serialize both states to canonical JSON.
5. Canonicalize IDs on both.
6. Diff (using `fast-deep-equal` or similar).
7. If different: format a human-readable diff showing (path, forge-value, ts-value, context).
8. If matching: test passes.
9. Honor `expected_divergence` annotations (see below).

## Scenario format

Human-editable YAML. Readable by both runtimes. Example shape:

```yaml
schema: 1
name: "combat-double-strike-vs-first-strike"
format: "legacy"
seed: "0x123456789abcdef0"
players:
  - seat: 0
    deck: "decks/test/mono-red-burn.dck"
    starting_life: 20
  - seat: 1
    deck: "decks/test/mono-white-soldier.dck"
    starting_life: 20
starting_hands:
  - seat: 0
    cards: ["Mountain", "Mountain", "Lightning Bolt", "Goblin Guide", ...]
  - seat: 1
    cards: [...]
decisions:
  - { turn: 1, phase: "PreCombatMain", seat: 0, kind: "priority", response: { action: "play_land", cardIndex: 0 } }
  - { turn: 1, phase: "DeclareAttackers", seat: 0, kind: "declareAttackers", response: { attackers: [{ attacker: 1, defender: { player: 1 } }] } }
  # ... full decision log
expected_divergence: []  # empty = strict match required
```

Decision references are by canonical key patterns (e.g., `cardIndex` into the seat's zone at decision time), not raw IDs, so a scenario file remains valid across runtimes.

## Known-divergence annotations

Cases where we intentionally differ from Forge (upstream bug we fix, behavior we correct per CR but Forge has not yet updated):

```yaml
expected_divergence:
  - path: "players[0].life"
    reason: "Forge bug: damage-prevention triggers fire in wrong order for card X. Fixed in our port per CR 614.12. See issue #42."
  - path: "players[0].zones.graveyard[2]"
    reason: "Same bug class, different manifestation."
```

Without matching annotations, any difference fails the test.

## Scope for v1.0

- **100-200 canonical scenarios** covering:
  - Basic combat (attack, block, damage assignment, trample, first/double strike, deathtouch).
  - Stack and priority sequencing.
  - State-based actions (creature dies, player loses, legend rule).
  - Triggered abilities with APNAP ordering.
  - Replacement effect chains.
  - Static abilities stacking via layers.
  - Commander color identity + commander damage.
  - Mulligan variants.
  - Multiplayer scenarios (3 and 4 players).
  - Cast-abort rollback paths.
  - Copy effects and token cease-to-exist.
  - Specific edge cases from CR sections that commonly trip implementations.
- Scenarios authored progressively as SP2 subsystems land, in lockstep with implementation. Each SP2/SP3/SP4/SP5 phase adds its relevant scenarios.

## Phases

| Phase | Scope | Blocks on |
|---|---|---|
| **0a** | Java harness wrapping Forge headless-runnable | SP4a (vendored card data) |
| **0b** | Canonical state format + JSON schema + canonicalization pass | 0a |
| **0c** | Scenario format definition + parsers in Java and TS | 0a, 0b |
| **0d** | TS runner + diff tooling + CI integration | 0b, 0c, SP1 (our TS engine must exist to drive) |
| **0e** | Initial 30-50 scenarios covering combat, stack, SBAs | 0d |

After 0e, the oracle is operational. Subsequent sub-projects add scenarios as part of their own work.

## CI integration

Two workflow hooks:

- **Per-commit** — runs 5-10 representative scenarios (fast smoke test). Target <2 minutes.
- **Nightly** — runs all 100-200 scenarios. Target <30 minutes. Failures email/ping maintainer.
- **Release gate** — full suite must pass on the release branch before publication.

CI runner has Node 20/22 + JDK 17. Forge fat JAR pulled from pinned release artifact.

## Testing strategy for SP0 itself

SP0 is testing infrastructure, but it has bugs and edge cases like any software. Tests for SP0:

- **ID canonicalization round-trip** — canonicalize then re-canonicalize produces identical output.
- **Scenario parsing round-trip** — parse a scenario, re-serialize, parse again; all three match.
- **Java harness smoke test** — starts Java process, loads deck, exits cleanly on a no-op scenario.
- **Diff reporting** — construct two known-different states, verify the diff output locates the difference correctly.
- **Known-divergence annotation** — matching annotation suppresses the error; non-matching annotation still fails.

## Out of scope for SP0

- Fixing bugs found by the oracle — those go to the relevant sub-project.
- Exhaustive card-by-card scenario coverage (32k cards). Target is coverage of rule interactions, not card library enumeration; individual cards covered by fixture tests in SP3.
- Testing AI behavior (fuzzy by nature; AI win-rate tests live in SP5 + SP8).
- Performance testing (benchmarks live in SP8).
