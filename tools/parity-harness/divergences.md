# Divergence catalog — M2 cohort

Per-scenario divergence classification produced by the M4 parity harness
(`packages/game/test/parity/runner.ts`) on the M2 30-scenario cohort.

Each row says: which scenario, what severity the parity harness assigned,
and which documented M3-MVP bridge limits explain the gap. No scenario
landed in `real-divergence-investigate` for this run, so there is no
"likely real bug" backlog from this cohort.

## Severity legend

- **match** — the normalized event-kind sets agree on both sides.
  Java MVP captured at least the headline action(s) we expect.
- **mvp-known** — divergences are entirely explained by documented
  bridge MVP limitations. M5 work to lift those limits will collapse
  these into `match`.
- **unknown-divergence** — TS sees event-kinds Java doesn't, and
  none of them are explained by an MVP bucket. **Treat as a real
  parity bug.** This run has zero of these.

## Divergence class buckets

- `target-mismatch` — Java MVP doesn't bind scripted targets. TS-only
  `CardTargeted` and `CrimeCommitted` events go here.
- `free-cast-missing-mana` — Java MVP casts spells without paying cost.
  TS-only `ManaSpent` and `CostPaid` go here.
- `no-stack-drain` — Java MVP pushes onto the stack but doesn't drain
  via `mainLoopStep` for our cohort. TS-only `DamageDealt`, `LifeChanged`,
  `LifeLost`, `LifeGained`, `CardDrawn`, `CardTapped`, `StackItemResolved`
  go here.
- `bridge-action-skipped` — Java MVP captured zero events for a cast
  action. The bridge silently skipped the cast (sometimes due to AI
  rejecting the cast, sometimes due to the cast pipeline raising). TS-only
  `SpellCast` and post-resolution `CardChangedZone` (spell→graveyard) go
  here.
- `shallow-trigger-fanout` — TS captures secondary trigger fan-out
  (Mulldrifter draw two, Soul Warden gain 1 life). Currently zero
  scenarios surface this because the M2 trace runner doesn't drive
  trigger resolution either — the gap will widen once both runners gain
  full stack drain.

## Cross-side kind aliases

- TS `AbilityActivated` ≡ Java `SpellCast`. Forge folds activated and
  triggered abilities into the same `GameEventSpellAbilityCast` type.
  The harness treats these as equivalent so e.g. Llanowar Elves'
  tap-for-mana (TS `AbilityActivated`, Java `SpellCast`) is `shared`,
  not divergent.

## Per-scenario classification

(Source: `tools/parity-harness/reports/parity-*.md`. This summary is
hand-rolled to add per-scenario root-cause notes.)

| Scenario                          | Severity   | Notes |
| ---                               | ---        | --- |
| `grizzly-bears-etb`               | match      | Pure ETB, no triggers/cost — both sides emit one CardChangedZone. |
| `mulldrifter-etb-draw`            | match      | ETB primary lands; Mulldrifter's "draw two" trigger fan-out is missing on **both** sides (TS runner is single-action, doesn't resolve queued triggers; Java MVP is shallow). Will surface once both sides drain. |
| `eternal-witness-etb-return`      | match      | ETB primary lands. Witness's "return target from grave" trigger same as Mulldrifter — invisible on both sides for now. |
| `glorious-anthem-static`          | match      | Pure static + ETB. |
| `honor-of-the-pure-static`        | match      | Pure static + ETB. |
| `doubling-season-etb`             | match      | Pure replacement install + ETB. |
| `rest-in-peace-etb`               | match      | Pure replacement install + ETB. |
| `serra-angel-etb`                 | match      | Pure ETB. |
| `birds-of-paradise-etb`           | match      | Pure ETB. |
| `angel-of-mercy-etb`              | match      | Pure ETB; ETB life-gain trigger same suppression as Mulldrifter. |
| `sulfuric-vortex-etb`             | match      | Pure ETB; "each upkeep" trigger doesn't fire (single turn, no upkeep). |
| `tarmogoyf-etb`                   | match      | Pure ETB; CDA P/T computed by TS layers, no event needed. |
| `giant-spider-etb`                | match      | Pure ETB. |
| `soul-warden-creature-etb`        | match      | Pure ETB; Soul Warden's "gain 1" trigger same suppression. |
| `soul-warden-angel-chain`         | match      | Two ETBs, both lands. Trigger fan-out from Warden seeing the Angel ETB invisible on both sides. |
| `counterspell-in-hand`            | match      | Card just sits in hand; both sides emit zero events. |
| `negate-in-hand`                  | match      | Same as Counterspell. |
| `settle-the-wreckage-in-hand`     | match      | Same. |
| `llanowar-elves-tap-for-mana`     | mvp-known  | TS-only `CardTapped` (the tap cost). Java treats activated ability as `SpellCast` (shared via alias). `no-stack-drain`. |
| `sol-ring-tap-for-mana`           | mvp-known  | Same shape as Llanowar Elves. `no-stack-drain`. |
| `shivan-dragon-firebreathing`     | mvp-known  | TS-only `ManaSpent` (firebreathing cost). Both sides see ETB+activation (alias). `free-cast-missing-mana`. |
| `holy-day-cast`                   | mvp-known  | TS-only `ManaSpent` + `CostPaid`. SpellCast shared. `free-cast-missing-mana`. |
| `wrath-of-god-cast`               | mvp-known  | Same as Holy Day. `free-cast-missing-mana`. Wrath's "destroy all creatures" effect not visible because cohort has empty battlefield. |
| `cloudshift-cast`                 | mvp-known  | TS-only target + cost events. `target-mismatch` + `free-cast-missing-mana` + `bridge-action-skipped` (Cloudshift's resolve effect missing because Java didn't capture). |
| `giant-growth-cast`               | mvp-known  | Same shape as Cloudshift (instant with target). |
| `stone-rain-cast`                 | mvp-known  | Sorcery with target — same envelope. |
| `lightning-bolt-target-creature`  | mvp-known  | Headline burn spell — exposes every MVP limit at once: `target-mismatch` + `free-cast-missing-mana` + `bridge-action-skipped` + `no-stack-drain`. M5 fixes will collapse this row to `match`. |
| `lightning-bolt-target-player`    | mvp-known  | Same as creature variant; adds `LifeChanged` / `LifeLost` events on the TS side. |
| `double-lightning-bolt`           | mvp-known  | Two bolts in sequence; same envelope, doubled counts. |
| `ancestral-recall-cast`           | mvp-known  | Single instant that draws three. TS-only `CardDrawn`×3 lands in `no-stack-drain`. |

## Aggregate this run

- 30 scenarios.
- **18 full match** (60% — primarily the simple ETB / no-action cohort).
- **12 mvp-known** (40% — every cast scenario lands here because the
  Java MVP doesn't pay costs / drain stack / bind scripted targets).
- **0 unknown** — no real divergences for the M3 MVP / M4 harness.

## Real divergences? Per-side correctness analysis

Since this run has zero `real-divergence-investigate` rows, there is
no per-CR root-cause needed. All gaps trace back to the M3 bridge MVP
spec'ing out specific features:

| Java MVP feature absent | TS does this correctly | M5 fix path |
| ---                     | ---                    | --- |
| Cost payment            | Yes (`ManaSpent`/`CostPaid` events fire) | Bridge: pay cost via Forge `Cost.payAbility(...)` instead of bypassing |
| Scripted target binding | Yes (target carried in scenario) | Bridge: `sa.setTargetCard(...)` before `stack.add(sa)` |
| Stack drain to effect   | Yes (effects resolve, events fire) | Bridge: drive Forge `mainLoopStep`/`PhaseHandler` until stack empty |
| Trigger fan-out         | Currently no (TS runner is single-action) | Both sides need stack-drain to see this |

Once M5 lifts those, the parity report should converge on near-100%
matches for this cohort.
