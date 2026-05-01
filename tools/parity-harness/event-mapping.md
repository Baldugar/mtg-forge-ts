# Event mapping — TS golden vs Java golden

Reference for the parity harness in `packages/game/test/parity/`. Captured
during a side-by-side audit of the M2 30-scenario corpus.

## Trace shape

Both sides emit a top-level JSON object:

```jsonc
{
  "scenarioId": "...",
  "seed": <number>,
  "engineVersion": "ts-m2-0.1.0" | "forge-bridge-mvp-0.1.0",
  "events":      [<GoldenEvent>...],
  // Java only:
  "setupEvents": [<GoldenEvent>...]
  // TS only:
  "finalState":  { ... }
}
```

`GoldenEvent` on both sides has `kind`, `turn`, `phase`, `payload`. The
shapes inside `payload` differ (see below).

## What appears on both sides

| Event kind         | Same name | Notes |
| ------------------ | --------- | ----- |
| `CardChangedZone`  | yes       | TS payload: `{cardId, fromZone, toZone, fromSeat, toSeat}`. Java payload: `{cardName, cardId, fromZone, toZone}` (no seats; identifies by name). |
| `SpellCast`        | yes       | TS payload: `{stackItemId, cardId, controllerSeat}`. Java payload: `{stackIndex, description}` (no card linkage). |
| `StackItemResolved`| TS-only effectively | Java's `GameEventSpellResolved` is wired but the MVP runner's stack-drain doesn't reach it for our test cohort, so the Java goldens never carry it. |

## TS-only events

These are TS engine internal events. Java does not emit equivalents:

- `CardTargeted`         — TS emits when a SpellAbility binds a target. Forge folds this into the cast pipeline.
- `CrimeCommitted`       — MTG 2024 crimes. Forge tracks crimes via `CombatLki` / state-effects, no event.
- `ManaSpent`            — Forge does not emit per-mana-spent events at this granularity.
- `CostPaid`             — Forge fires this internally but bridge MVP does not pay costs (`stack.add` bypasses cost).
- `DamageDealt`          — Forge has `GameEventCardDamaged` / `GameEventPlayerDamaged` but bridge MVP doesn't drain stack to resolution, so no damage fires.
- `LifeChanged`          — Forge has `GameEventPlayerLivesChanged`; same MVP-drain issue.
- `LifeLost`             — TS-side decomposition of life delta; Forge is single event.
- `CardDrawn`            — TS-side; Forge folds into `GameEventCardChangeZone(Library→Hand)`.
- `CardTapped`           — TS-side; Forge has `GameEventCardTapped` but bridge MVP doesn't capture the AbilityActivated / tap-cost path.
- `AbilityActivated`     — TS-side; Forge has `GameEventSpellAbilityCast` for activated abilities (folded into `SpellCast` on the bridge side).

## Java-only events

None for the M3 MVP. The bridge subscribes selectively to the Forge
EventBus (see `BridgeRunner.TraceRecorder`) and routes everything else
to the dead-letter sink. Future iterations may capture more.

## Phase labels

- TS: `"Untap"` for all M2 scenarios (the runner doesn't advance phases — actions execute in seed phase).
- Java: `"Main1"` for all M2 scenarios (Forge initializes Game in MAIN1 stage).

The parity harness normalizes both sides to a canonical phase label
(`<phase>` is dropped from comparison entirely for M4 MVP — phase-label
parity is an M5 concern once the bridge drives real phase progression).

## Entity ID numbering

- TS: ids start from `0` and increment per `Game.newEntityId()` call.
  Battlefield permanents seeded first, then hand, etc.
- Java: ids start from `1` and increment via Forge's internal counter.
  Different cards get different ids than TS. Card identity is
  established via `cardName` on the Java side; TS uses `cardId` only.

The parity harness normalizes by **dropping numeric ID fields** and
comparing on `cardName` (Java) ↔ via lookup-from-cardId (TS) when needed.

## Zone labels

Both sides use the same casing: `"Battlefield"`, `"Hand"`, `"Graveyard"`,
`"Library"`, `"Exile"`, `"Stack"`. No mapping needed.

## Card identity

- TS: identified by `cardId`. The runner snapshots a `cardsByName` map
  but does not echo the name into the event payload.
- Java: includes `cardName` directly in `CardChangedZone` payloads.

For parity, the harness:
1. On the TS side, joins each `CardChangedZone` event's `cardId` against
   the scenario's seeded card lookup to recover the name.
2. On the Java side, reads `cardName` directly.

After this normalization, comparison is by `cardName + fromZone + toZone`
(seat is dropped — Java doesn't carry it).

## Setup vs action events

- TS `events`: includes setup ETBs (battlefield seeding) **and** action
  events in one stream.
- Java `events`: contains only **action** events. `setupEvents` is the
  parallel array for battlefield-seeding moveTo events.

The parity harness reconstructs an apples-to-apples comparison by:
- Java side: concatenating `[...setupEvents, ...events]` into a single
  ordered stream.
- TS side: using `events` as-is.

This is correct because the TS runner emits setup ETB events before
the first action's events (see `runScenario` in `runner.ts`), matching
the implicit ordering of `setupEvents → events` on the Java side.

## Volatile fields stripped from comparison

For M4 parity comparison, the harness strips:

- All numeric IDs (`cardId`, `stackItemId`, `stackIndex`, `sourceCardId`,
  `targetId`, `victimCardId`).
- All seat indices (`controllerSeat`, `fromSeat`, `toSeat`, `playerSeat`,
  `victimSeat`, `targetingSeat`).
- The `phase` field (TS=Untap, Java=Main1).
- The `description` field on Java `SpellCast` (always null for MVP).
- Numeric `color` codes inside `ManaSpent` (TS uses `Color` enum int).

What remains for comparison:

- `kind`
- `turn`
- For `CardChangedZone`: `cardName`, `fromZone`, `toZone`.
- For `SpellCast`: just the kind+turn (no payload comparison, since
  Java doesn't expose card linkage).

## Filtering rules (M3 MVP normalization)

Per the bridge's known limitations (`tools/forge-bridge/README.md`):

1. **Shallow trigger fan-out (M3 MVP)** — the Java side does not capture
   secondary triggers (Mulldrifter draw two, Soul Warden gain 1 life).
   The harness classifies any TS event whose existence depends on a
   trigger fan-out as `shallow-trigger-fanout`. It does NOT count these
   as real divergences.

2. **AI-picked targets (M3 MVP)** — Java MVP does not bind scripted
   targets. The harness treats `CardTargeted` and `CrimeCommitted` events
   as expected-only-on-TS; their absence on the Java side is classified
   `target-mismatch`.

3. **Free casts, no cost paid (M3 MVP)** — Java MVP does not pay costs.
   `ManaSpent` and `CostPaid` are expected-only-on-TS; their absence on
   the Java side is classified `free-cast-missing-mana`.

4. **No stack drain (M3 MVP)** — the Java bridge pushes spells onto the
   stack but does not drain via `mainLoopStep` for our cohort. Effects
   like damage / life change / draw / put-into-graveyard never fire on
   the Java side. Their absence is classified `no-stack-drain`.

## Canonical comparison strategy (M4 MVP)

Given the gulf between the two trace formats, hard event-by-event parity
is impossible at M3-MVP. The M4 harness instead computes:

1. **Event-kind histogram per side** — `{ CardChangedZone: 2, SpellCast: 1 }`.
2. **Primary-action match** — did Java see "the card moved to its
   expected destination zone" (CardChangedZone with matching cardName +
   target zone)? This is the headline parity signal.
3. **Divergence classification** — for each TS-only event-kind, place it
   into one of the four MVP-limit buckets above OR `real-divergence-investigate`
   if it doesn't fit any known limitation.

The output is a `ParityReport` with structured class counts. Hard parity
becomes the M5 goal once the bridge gains stack-drain, scripted targets,
and cost payment.
