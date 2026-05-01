# Divergence catalog — M2 cohort (post-Bridge V2)

Per-scenario divergence classification produced by the M4 parity harness
(`packages/game/test/parity/runner.ts`) on the M2 30-scenario cohort,
captured against the V2 bridge (`forge-bridge-v2-0.2.0`) at HEAD
(post-Testing-M3.5). No scenario landed in `real-divergence-investigate`,
so there are no real bugs to chase from this cohort.

## Severity legend

- **match** — the normalized event-kind sets agree on both sides.
- **mvp-known** — divergences are entirely explained by documented
  bucket(s) below.
- **unknown-divergence** — TS or Java has events not explained by an
  MVP bucket. **Treat as a real parity bug.** Currently zero of these.

## Divergence class buckets (post-V2)

- `target-mismatch` — TS emits `CardTargeted` / `CrimeCommitted` for
  scripted targets; Forge has no equivalent event-kind (targeting is
  folded into the `GameEventSpellAbilityCast` payload). The bridge V2
  binds the right targets, but the kinds themselves don't appear on the
  Java side.
- `free-cast-missing-mana` — TS emits `CostPaid` to mark cost completion;
  Forge fires `GameEventManaPool(Removed)` per mana globe (mapped to
  `ManaSpent` in our trace) but no aggregate `CostPaid`. With V2 the
  individual `ManaSpent` events do show up on both sides; only the
  TS-only `CostPaid` umbrella event survives in this bucket.
- `no-stack-drain` — TS-only events that V2's bridge drain should now
  match (this bucket has shrunk to 1 scenario, ancestral-recall, where
  TS emits `CardDrawn` per draw but Forge emits a single
  `CardChangedZone` per drawn card without a separate `CardDrawn`).
- `bridge-action-skipped` — was the dominant V1 class; now zero. V2's
  cost-payment + target-binding makes every cast in this cohort land.
- `ts-runner-shallow` — Java-only events from V2's full stack drain
  that the **M2 TS golden runner** hasn't caught up to yet. The TS
  runner is single-action (resolves only the primary cast / etb) so
  triggered-ability `SpellCast` events, the `StackItemResolved` flag,
  resolution-zone `CardChangedZone` (spell→graveyard) and
  `LifeTotalChanged` from triggered life-changes are all Java-only.
  Closing these is M5 work on the TS runner, **not** the bridge.

## Cross-side kind aliases

- TS `AbilityActivated` ≡ Java `SpellCast` (Forge folds activated /
  triggered / spell casts under one event-kind).
- TS `LifeChanged` / `LifeGained` / `LifeLost` ≡ Java `LifeTotalChanged`
  (Forge has one `GameEventPlayerLivesChanged`; TS splits gain vs lose).
- TS `CardTapped` ≡ Java `CardTappedChanged` (Forge fires
  `GameEventCardTapped`; TS uses a slightly different name).

## Aggregate this run (post-V2)

- 30 scenarios.
- **14 full match** (47%). Up from 18 V1 — the count *dropped* because
  V2 surfaces real Java-side events that the TS runner doesn't emit
  yet, lifting some scenarios out of "match" into `mvp-known/
  ts-runner-shallow`. Each of those is a TS-runner gap, not a bridge
  regression.
- **16 mvp-known** (53%). All entries classified into documented
  buckets.
- **0 unknown** (`real-divergence-investigate`). Hard contract held.

## Per-scenario classification (post-V2)

| Scenario                          | Severity   | Notes |
| ---                               | ---        | --- |
| `grizzly-bears-etb`               | match      | Pure ETB, both sides emit one `CardChangedZone`. |
| `mulldrifter-etb-draw`            | mvp-known  | Java now drains: 1× `SpellCast` (the trigger), 2× `CardChangedZone` (Library→Hand draws), `StackItemResolved`. TS runner hasn't caught up — `ts-runner-shallow`. |
| `eternal-witness-etb-return`      | mvp-known  | Same shape as Mulldrifter — `ts-runner-shallow`. |
| `glorious-anthem-static`          | match      | Pure static + ETB. |
| `honor-of-the-pure-static`        | match      | Pure static + ETB. |
| `doubling-season-etb`             | match      | Pure replacement install + ETB. |
| `rest-in-peace-etb`               | mvp-known  | Java fires the install trigger; TS runner shallow. |
| `serra-angel-etb`                 | match      | Pure ETB. |
| `birds-of-paradise-etb`           | match      | Pure ETB. |
| `angel-of-mercy-etb`              | mvp-known  | Java fires gain-3 trigger + `LifeTotalChanged`; TS shallow. |
| `sulfuric-vortex-etb`             | match      | Pure ETB. |
| `tarmogoyf-etb`                   | match      | Pure ETB; CDA P/T no event needed. |
| `giant-spider-etb`                | match      | Pure ETB. |
| `soul-warden-creature-etb`        | mvp-known  | Java fires Warden's gain-1 trigger; TS shallow. |
| `soul-warden-angel-chain`         | mvp-known  | Java fires Warden + Angel triggers + `LifeTotalChanged` ×2; TS shallow. |
| `counterspell-in-hand`            | match      | No actions; both sides empty. |
| `negate-in-hand`                  | match      | Same. |
| `settle-the-wreckage-in-hand`     | match      | Same. |
| `llanowar-elves-tap-for-mana`     | match      | V2 promoted to match — synthetic `SpellCast` for mana ability + shared `CardTapped` alias. |
| `sol-ring-tap-for-mana`           | match      | Same as Llanowar. |
| `shivan-dragon-firebreathing`     | mvp-known  | Activation cost `{R}` paid through V2 cost pipeline; only Java-only `StackItemResolved` remains (`ts-runner-shallow`). |
| `holy-day-cast`                   | mvp-known  | TS-only `CostPaid` (umbrella event) + Java-only `CardChangedZone` (Stack→Graveyard) and `StackItemResolved`. |
| `wrath-of-god-cast`               | mvp-known  | Same envelope as Holy Day. |
| `cloudshift-cast`                 | mvp-known  | Targets bound (Grizzly Bears found by name). TS-only `CardTargeted`/`CostPaid`; Java-only `StackItemResolved`. |
| `giant-growth-cast`               | mvp-known  | Same as Cloudshift. |
| `stone-rain-cast`                 | mvp-known  | Same shape — `target-mismatch` + `free-cast-missing-mana` + `ts-runner-shallow`. |
| `lightning-bolt-target-creature`  | mvp-known  | Massive shared event set: ManaSpent / SpellCast / DamageDealt / StackItemResolved / CardChangedZone all match. Residual: TS-only CardTargeted/CrimeCommitted/CostPaid. |
| `lightning-bolt-target-player`    | mvp-known  | Even richer — adds `LifeChanged`/`LifeLost` (TS) ↔ `LifeTotalChanged` (Java) via alias. |
| `double-lightning-bolt`           | mvp-known  | Two-bolt sequence; Java emits an extra `LifeTotalChanged` per bolt (alias + ts-runner-shallow on extra). |
| `ancestral-recall-cast`           | mvp-known  | Drives 3× `CardChangedZone` (Library→Hand) on both sides. TS-only `CardDrawn` (`no-stack-drain` because TS runner emits a separate kind). |

## What changed vs the V1 / M3-MVP baseline

| V1 class              | V1 count | V2 count | Notes |
| ---                   | ---      | ---      | --- |
| `target-mismatch`     | 6        | 6        | Unchanged — TS emits `CardTargeted` kinds Forge doesn't have. |
| `free-cast-missing-mana` | 10    | 9        | Down because individual `ManaSpent` events now match; only `CostPaid` umbrella event remains TS-only. |
| `no-stack-drain`      | 6        | 1        | Almost cleared — V2 drains the stack. Only `ancestral-recall-cast` remains because TS emits a `CardDrawn` kind Forge doesn't. |
| `bridge-action-skipped` | 7      | 0        | Cleared — V2 cost-payment + target-binding makes every cast land. |
| `shallow-trigger-fanout` | 0     | 0        | Trigger fan-out now lands on Java (Mulldrifter, Soul Warden, Angel of Mercy etc.). |
| `ts-runner-shallow` (new) | n/a   | 13       | **New bucket.** Java now sees Forge's full resolution events; the M2 TS runner doesn't emit them yet. M5 closes this. |

## Real divergences? Per-side correctness analysis

Zero `real-divergence-investigate` rows. The remaining gaps split into:

| Gap                                  | Side affected | M5 fix path |
| ---                                  | ---           | --- |
| `CostPaid` umbrella event            | TS-only       | Map TS `CostPaid` to Java `ManaSpent` via alias, or drop CostPaid as engine-internal. |
| `CardTargeted` / `CrimeCommitted`    | TS-only       | Drop / aliasing — Forge has no equivalent kind. |
| `CardDrawn` (vs Java's bare CardChangedZone) | TS-only | Alias `CardDrawn` ↔ `CardChangedZone(Library→Hand)` with origin/dest match. |
| Triggered-ability fan-out events     | Java-only     | TS runner needs to drive trigger resolution end-to-end (M5). |
| `StackItemResolved`                  | Java-only     | TS runner needs to emit on each stack-item resolve (M5). |
| `LifeTotalChanged` (post-trigger)    | Java-only     | TS runner already emits `LifeChanged` — alias once trigger fan-out lands. |
