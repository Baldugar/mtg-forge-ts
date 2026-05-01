# Divergence catalog — M2 cohort (post-Bridge V2 + TS runner V2 + M4.5 + M5)

Per-scenario divergence classification produced by the M4 parity harness
(`packages/game/test/parity/runner.ts`) on the M2 30-scenario cohort,
captured against the V2 bridge (`forge-bridge-v2-0.2.0`) and the V2 TS
golden runner (Testing M2.5 — stack-drain symmetric with Bridge V2),
with the M4.5 alias-map and engine-internal-stripping fixes applied,
and M5's DealDamage target-kind discrimination fix landed.

No scenario landed in `real-divergence-investigate`, so there are no
real bugs to chase from this cohort.

## Severity legend

- **match** — the normalized event-kind sets agree on both sides.
- **mvp-known** — divergences are entirely explained by documented
  bucket(s) below.
- **unknown-divergence** — TS or Java has events not explained by an
  MVP bucket. **Treat as a real parity bug.** Currently zero of these.

## Aggregate this run (post-M5)

- 30 scenarios.
- **29 full match** (97%). Up from 28 (post-M4.5), 16 (post-V2 + M2.5).
- **1 mvp-known** (3%). `rest-in-peace-etb`, tagged `ts-runner-shallow`.
- **0 unknown** (`real-divergence-investigate`). Hard contract held.

## What M5 changed

M4.5 surfaced one real engine bug via parity testing (the rest were
classified bridge-MVP gaps). M5 fixes that bug.

**DealDamageEffect target-kind discrimination.** Pre-M5, the effect
discriminated player-vs-creature recipients by probing
`game.cards.get(targetId)` — if the lookup returned a card it routed as
creature damage, otherwise player damage. Card IDs and player seats are
both branded numbers from the same allocation pool, so when a player
seat (typically 0 or 1) numerically collided with an existing cardId
(cards allocate from low integers too) the probe false-positively
matched the colliding card and player damage was silently routed as
creature damage. The `double-lightning-bolt` parity scenario hit this
directly: Lightning Bolt #2's cardId was 1, the player target's seat
was also 1, both bolts resolved as "creature damage" and no
`LifeChanged` event fired on the TS side.

**Fix:** SpellAbility now carries a discriminated `targetRefs:
readonly { kind: "card" | "player"; ... }[]` array bound at cast time
from the `chooseCastTargets` decision. DealDamageEffect consults
`targetRefs` first and routes by explicit kind, falling back to the
legacy `game.cards.get(id)` probe only for synthesized SpellAbilities
(keyword handlers, splice fan-out) that haven't been migrated yet.

**Closed scenario:** `double-lightning-bolt` now full-match (was
`mvp-known: ts-runner-shallow`).

## Residual 1 mvp-known

Rest in Peace's static-replacement install fires a Forge-side
`SpellCast(description: null) + StackItemResolved(hasFizzled: false)`
pair. Forge routes the static-installation through the same trigger
machinery as a real cast / resolution, even though no spell actually
hit the stack. The TS engine's static-installation path is silent —
equivalent to "trigger fires but produces no events." Both behaviours
are CR-faithful; this is a pure event-emission style difference.

Decision (M5): leave the divergence as documented `mvp-known:
ts-runner-shallow` rather than (a) emitting matching synthetic events
on the TS side or (b) stripping the Java install pair as
engine-internal. Path (a) would pollute the TS event stream with
trigger-shaped events that have no resolver / payload. Path (b) needs
a discriminator the bridge doesn't surface (the install-trigger pair
is structurally identical to a real null-description SpellCast +
resolution — and other matched scenarios like `shivan-dragon-firebreathing`
also emit `description: null` SpellCasts that we DO want to match).
The cost of either path exceeds the parity-signal gained from closing
one scenario.

## What M4.5 changed

Three fixes converted 12 mvp-known scenarios into full matches:

1. **Engine-internal event stripping (TS-side).** The harness now
   drops six TS-only event kinds before comparison: `CardDestroyed`,
   `StateBasedActionApplied`, `CostPaid`, `CardTargeted`,
   `CrimeCommitted`, and `CardDrawn`. These are bookkeeping events
   the TS engine emits on top of the canonical zone-move /
   `ManaSpent` / `SpellCast` events that Forge already shares — the
   Java side represents the same semantic facts via the canonical
   `CardChangedZone(Battlefield→Graveyard)` for destroys, the
   `CardChangedZone(Library→Hand)` for draws, the per-globe
   `ManaSpent` for cost payment, and the `SpellCast` payload for
   targeting. Stripping the TS-only umbrellas removes pure noise.

2. **1-to-many alias map.** `KIND_ALIASES` was being interpreted as a
   flat 1-to-1 Map keyed by Java kind, so the three forward entries
   `LifeChanged ↔ LifeTotalChanged`, `LifeGained ↔ LifeTotalChanged`,
   `LifeLost ↔ LifeTotalChanged` collapsed to "LifeTotalChanged →
   LifeLost" alone. Scenarios that emit only `LifeChanged` (Soul
   Warden, Angel of Mercy) reported a phantom "Java-only
   LifeTotalChanged". The runner now stores aliases as
   `Map<string, string[]>` so any forward / reverse alias counts as
   a match. **Closed scenarios:** angel-of-mercy-etb,
   soul-warden-creature-etb, soul-warden-angel-chain.

3. **TS golden runner: don't double-bind targets.** When the cast
   pipeline already binds targets via `chooseCastTargets`, the
   `runCast` helper used to overwrite the resolver with a fresh
   SpellAbility constructor that took a hardcoded `[targetId]`
   array. For player targets that overwrite drops kind metadata.
   The runner now only patches when `stackItem.targets === null`,
   trusting the pipeline's binding otherwise.

## Residual 1 mvp-known (table)

| Scenario | Java-only kinds | Why |
| --- | --- | --- |
| `rest-in-peace-etb` | `SpellCast`, `StackItemResolved` (`ts-runner-shallow`) | Forge fires the ETB-installed trigger even with empty graveyards (the trigger does nothing but still queues / resolves). The TS engine's static-installation path is silent — equivalent to "trigger fires but produces no events." Both behaviours are CR-faithful; this is a pure event-emission style difference and not worth altering either side. M5 evaluated emitting a synthetic SpellCast/StackItemResolved on the TS side or stripping the Java install pair; both paths cost more than they gain. |

## Cross-side kind aliases

- TS `AbilityActivated` ≡ Java `SpellCast` (Forge folds activated /
  triggered / spell casts under one event-kind).
- TS `LifeChanged` / `LifeGained` / `LifeLost` ≡ Java `LifeTotalChanged`
  (Forge has one `GameEventPlayerLivesChanged`; TS splits gain vs lose).
- TS `CardTapped` ≡ Java `CardTappedChanged` (Forge fires
  `GameEventCardTapped`; TS uses a slightly different name).

## Engine-internal stripped (TS-side)

These TS event kinds are dropped before diff because they have no Java
counterpart and their semantics are already represented by canonical
shared events on both sides:

| TS kind | Why stripped |
| --- | --- |
| `CardDestroyed` | Canonical destroy is `CardChangedZone(Battlefield→Graveyard)` (shared on both sides). |
| `StateBasedActionApplied` | TS-only marker; Forge applies SBAs as part of resolveStack and emits the resulting zone moves directly. |
| `CostPaid` | Umbrella event bracketing per-globe `ManaSpent`. Forge has only the per-globe events. |
| `CardTargeted` | Forge folds targeting into the `SpellCast` payload (`targetDescription`). |
| `CrimeCommitted` | TS-only Murders-at-Karlov-Manor bookkeeping; Forge has no equivalent kind (CR 113.13 is computed lazily via context queries on the Java side). |
| `CardDrawn` | Forge represents draws as `CardChangedZone(Library→Hand)` (shared). |

## Per-scenario classification (post-M4.5)

| Scenario | Severity | Notes |
| --- | --- | --- |
| `grizzly-bears-etb` | match | Pure ETB. |
| `lightning-bolt-target-player` | match | Player targeting works; alias map collapses LifeChanged/LifeLost ↔ LifeTotalChanged. |
| `lightning-bolt-target-creature` | match | SBA destroy → shared `CardChangedZone(BF→GY)`; CardDestroyed/StateBasedActionApplied stripped. |
| `mulldrifter-etb-draw` | match | Draws shared via `CardChangedZone(Library→Hand)`; CardDrawn stripped. |
| `eternal-witness-etb-return` | match | |
| `glorious-anthem-static` | match | |
| `honor-of-the-pure-static` | match | |
| `doubling-season-etb` | match | |
| `rest-in-peace-etb` | mvp-known | Forge-side install-trigger fan-out; doc'd. |
| `llanowar-elves-tap-for-mana` | match | |
| `sol-ring-tap-for-mana` | match | |
| `counterspell-in-hand` | match | |
| `negate-in-hand` | match | |
| `cloudshift-cast` | match | |
| `holy-day-cast` | match | |
| `sulfuric-vortex-etb` | match | |
| `wrath-of-god-cast` | match | |
| `serra-angel-etb` | match | |
| `birds-of-paradise-etb` | match | |
| `giant-growth-cast` | match | |
| `soul-warden-creature-etb` | match | LifeChanged ↔ LifeTotalChanged via 1-to-many alias. |
| `ancestral-recall-cast` | match | Three draws shared via CardChangedZone(Library→Hand); CardDrawn stripped. |
| `shivan-dragon-firebreathing` | match | |
| `angel-of-mercy-etb` | match | LifeChanged ↔ LifeTotalChanged via 1-to-many alias. |
| `tarmogoyf-etb` | match | |
| `settle-the-wreckage-in-hand` | match | |
| `stone-rain-cast` | match | Land destroy → shared `CardChangedZone(BF→GY)`; CardDestroyed stripped. |
| `giant-spider-etb` | match | |
| `double-lightning-bolt` | match | M5 — DealDamage now routes by `sa.targetRefs` discriminator instead of `game.cards.get(id)` probe; player target with seat colliding cardId no longer misroutes as creature damage. |
| `soul-warden-angel-chain` | match | |

## How to verify the report

```bash
node tools/parity-harness/run-parity.mjs
# Expect:
#   full-match:  29
#   mvp-known:   1
#   unknown:     0
```

The vitest gate (`packages/game/test/parity/parity.test.ts`) refuses
any `unknown-divergence` and accepts `match` or `mvp-known` per
scenario; `pnpm --filter @mtg-forge-ts/game test parity` is the
machine-verifiable seal.
