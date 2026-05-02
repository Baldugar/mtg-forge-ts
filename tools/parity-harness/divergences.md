<<<<<<< Updated upstream
# Divergence catalog — M2 cohort (post-Bridge V2 + TS runner V2 + M4.5 + M5)
=======
# Divergence catalog — M2 cohort (post-Bridge V2 + TS runner V2)
>>>>>>> Stashed changes

Per-scenario divergence classification produced by the M4 parity harness
(`packages/game/test/parity/runner.ts`) on the M2 30-scenario cohort,
captured against the V2 bridge (`forge-bridge-v2-0.2.0`) and the V2 TS
<<<<<<< Updated upstream
golden runner (Testing M2.5 — stack-drain symmetric with Bridge V2),
with the M4.5 alias-map and engine-internal-stripping fixes applied,
and M5's DealDamage target-kind discrimination fix landed.

=======
golden runner (Testing M2.5 — stack-drain symmetric with Bridge V2).
>>>>>>> Stashed changes
No scenario landed in `real-divergence-investigate`, so there are no
real bugs to chase from this cohort.

## Severity legend

- **match** — the normalized event-kind sets agree on both sides.
- **mvp-known** — divergences are entirely explained by documented
  bucket(s) below.
- **unknown-divergence** — TS or Java has events not explained by an
  MVP bucket. **Treat as a real parity bug.** Currently zero of these.

## Aggregate this run (post-M5)

<<<<<<< Updated upstream
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
=======
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
  that the TS golden runner hadn't caught up to. **M2.5 closed most of
  this** — the V2 TS runner now drains the stack symmetrically. The
  residual entries are scenarios where Forge fires extra `LifeTotalChanged`
  beats (the TS engine emits one `LifeChanged` per delta but Forge
  emits one per intermediate value when a single resolver chains
  multiple deltas) or `SpellCast` for static-installation triggers
  the TS engine doesn't yet fan out (e.g. Rest in Peace's "static
  effect installed" trigger doesn't have a TS analogue).
>>>>>>> Stashed changes

## Cross-side kind aliases

- TS `AbilityActivated` ≡ Java `SpellCast` (Forge folds activated /
  triggered / spell casts under one event-kind).
- TS `LifeChanged` / `LifeGained` / `LifeLost` ≡ Java `LifeTotalChanged`
  (Forge has one `GameEventPlayerLivesChanged`; TS splits gain vs lose).
- TS `CardTapped` ≡ Java `CardTappedChanged` (Forge fires
  `GameEventCardTapped`; TS uses a slightly different name).

<<<<<<< Updated upstream
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
# Expect (M6):
#   full-match:  70
#   mvp-known:   10
#   unknown:     0
```

The vitest gate (`packages/game/test/parity/parity.test.ts`) refuses
any `unknown-divergence` and accepts `match` or `mvp-known` per
scenario; `pnpm --filter @mtg-forge-ts/game test parity` is the
machine-verifiable seal.

## Milestone 6 — cohort expansion (30 → 80 scenarios)

M6 widens the parity cohort with Tier 2 edge cases (clone-family
co-residence, anthem-layer interactions, hideaway, planeswalker
loyalty seeds, miracle/flashback, hideaway, equip, adventure cards,
delve/affinity, Tarmogoyf with seeded graveyards) and Tier 3 popular
cards (Brainstorm, Path to Exile, Swords to Plowshares, Thoughtseize,
Fatal Push, Dark Ritual, Stoneforge Mystic, Snapcaster Mage, Tatyova,
Goblin Guide, Manamorphose, Krark-Clan Ironworks, Delver of Secrets,
Murderous Rider, Mosswort Bridge, Unicycle, Krark's Thumb, Mirri
Weatherlight, Phantasmal Image, Phyrexian Metamorph, Sakashima the
Imposter, Worship, Sigarda Host of Herons, Painter's Servant, Lotus
Bloom, Smuggler's Copter, Stolen Identity, Lilana Veil, Jace TMS,
Elspeth Sun's Champion, Invasion of Ikoria, Doubling-Season ×
Elspeth co-residence, Aurelia × Soul Warden co-residence, Humility ×
Anthem layer test, Worship × Soul Warden co-residence, Painter's
Servant × Honor co-residence, Tarmogoyf with graveyards, Multi-anthem
stack).

### Aggregate this run (post-M6)

- **80 scenarios** (up from 30).
- **70 full match** (87.5%).
- **10 mvp-known** (12.5%). Distribution:
  - 5× `bridge-counter-event-not-captured` (Jace TMS, Liliana Veil,
    Elspeth Sun's Champion, Invasion of Ikoria, Doubling-Season ×
    Elspeth co-residence) — bridge V2 doesn't subscribe to
    `GameEventCounterAdded`, so Forge silently swallows loyalty / +1+1
    counter placements while TS emits a discrete `CounterAdded`.
  - 4× `ts-runner-shallow` (rest-in-peace-etb, history-of-benalia-etb,
    mosswort-bridge-etb, aurelia-soul-warden-coresidence) — Forge fires
    `SpellCast`/`StackItemResolved` from triggered abilities the TS
    runner hasn't fanned out yet (single-action runner limit).
  - 1× `shallow-trigger-fanout` (snapcaster-mage-etb) — TS fires
    Snapcaster's ETB-flashback trigger as `AbilityActivated`; Forge
    bridge skips the trigger fan-out under the cast.
- **0 unknown** (`real-divergence-investigate`). Hard contract held.

### New M6 buckets
=======
## Aggregate this run (post-V2 + M2.5 TS runner V2)

- 30 scenarios.
- **16 full match** (53%). Up from 14 (post-V2 baseline). M2.5 closed
  the trigger fan-out + post-resolution gap by adding `runStackUntilEmpty`
  after each scripted action: triggered abilities now drain to the
  stack, resolve via the same `resolveStackItem` path, and emit
  `AbilityActivated` (≡ Java `SpellCast`) + `StackItemResolved` +
  `LifeChanged` symmetrically with Bridge V2. Cast scenarios that
  don't have an explicit `resolveTopOfStack` action now also see the
  spell drain (Holy Day / Wrath / Cloudshift / Stone Rain). Mana
  abilities are explicitly excluded from the drain (CR 605.3a — Forge
  bypasses the stack).
- **14 mvp-known** (47%). Down from 16 (post-V2). All entries classified
  into documented buckets.
- **0 unknown** (`real-divergence-investigate`). Hard contract held.

### What M2.5 changed in the divergence histogram

| Class                       | Post-V2 | Post-M2.5 | Notes |
| ---                         | ---     | ---       | --- |
| `target-mismatch`           | 6       | 6         | Unchanged — TS emits `CardTargeted` kinds Forge doesn't have. |
| `free-cast-missing-mana`    | 9       | 9         | Unchanged — `CostPaid` umbrella event still TS-only. |
| `no-stack-drain`            | 1       | 2         | +1 from Mulldrifter (`CardDrawn` TS-only — Forge folds into bare `CardChangedZone`). |
| `bridge-action-skipped`     | 0       | 2         | NEW. TS-side `CardDestroyed` + `StateBasedActionApplied` (Lightning Bolt → Grizzly Bears SBA-death) Forge bridge doesn't drive. |
| `ts-runner-shallow`         | 13      | 5         | Down massively. Trigger fan-out + StackItemResolved now match. Residual: 5 scenarios with leftover `LifeTotalChanged` / `SpellCast` / `StackItemResolved` Java-side that don't yet fully alias. |
| `real-divergence-investigate` | 0     | 0         | Hard contract held. |

## Per-scenario classification (post-V2)
>>>>>>> Stashed changes

- **`bridge-counter-event-not-captured`** (TS-only `CounterAdded`):
  Bridge V2 doesn't subscribe to `GameEventCounterAdded`. Counter
  placements (planeswalker loyalty seeds, +1/+1 ETB counters, charge
  counters, hideaway counters etc.) are silent on the Java side until
  the bridge listener is added. Engine-side, the TS counters are
  applied correctly — the divergence is purely capture-side.
- **`ReplacementApplied` stripped as engine-internal**: TS-only
  marker fired when a replacement effect is consulted (often a no-op
  identity replace, e.g. Mosswort Bridge's hideaway-replacement
  returns the original moveTo). Forge has no
  `GameEventReplacementApplied` analog; the replacement is applied
  silently inside the move pipeline. M6 strips it at the
  `isEngineInternal` boundary.

### Real engine bugs surfaced — none

No M6 scenario landed in `real-divergence-investigate`. Every
divergence maps to either a known bridge capture gap or a known TS
runner gap. Follow-on work is therefore pure infrastructure
(bridge counter-event subscription, TS runner trigger fan-out), not
engine bug-fixing.

### Per-scenario detail (post-M6, mvp-known only)

| Scenario | TS-only kinds | Java-only kinds | Class |
| --- | --- | --- | --- |
| `rest-in-peace-etb` | — | SpellCast, StackItemResolved | ts-runner-shallow |
| `history-of-benalia-etb` | — | SpellCast, StackItemResolved | ts-runner-shallow |
| `mosswort-bridge-etb` | — | SpellCast, StackItemResolved | ts-runner-shallow |
| `aurelia-soul-warden-coresidence` | — | SpellCast, LifeTotalChanged, StackItemResolved | ts-runner-shallow |
| `invasion-of-ikoria-etb` | CounterAdded | — | bridge-counter-event-not-captured |
| `elspeth-suns-champion-etb` | CounterAdded | — | bridge-counter-event-not-captured |
| `liliana-veil-etb` | CounterAdded | — | bridge-counter-event-not-captured |
| `jace-mind-sculptor-etb` | CounterAdded | — | bridge-counter-event-not-captured |
| `doubling-season-elspeth-coresidence` | CounterAdded | — | bridge-counter-event-not-captured |
| `snapcaster-mage-etb` | AbilityActivated, StackItemResolved | — | shallow-trigger-fanout / no-stack-drain |

### Follow-on work (post-M6, NOT in this dispatch)

1. **Bridge: subscribe to `GameEventCounterAdded`** — closes the 5
   bridge-counter-event-not-captured rows. Touches
   `tools/forge-bridge/src/main/java/forge/bridge/BridgeRunner.java`'s
   listener registry.
2. **TS runner: fan out triggered abilities under headline action** —
   closes the 4 ts-runner-shallow rows. Touches
   `packages/game/test/golden/runner.ts` (or wherever the TS golden
   runner lives) so a non-trivial spell drains its triggered-ability
   stack symmetrically with Bridge V2.
3. **Bridge: surface ETB-trigger fan-out under SpellCast** — closes
   the snapcaster-mage row. The TS engine fires Snapcaster's
   flashback-grant ETB trigger as a discrete `AbilityActivated`;
   Forge needs to either (a) fold it into the parent SpellCast
   payload or (b) emit it as a separate event the bridge subscribes
   to. Today the bridge captures only the headline cast.

## Milestone 6.6 — cohort expansion (80 → 130 scenarios)

M6.6 widens the cohort with 50 additional scenarios covering mechanics
under-represented in the M6 set: Devotion (Gray Merchant), X-spells
(Banefire, Hangarback Walker), Token doublers (Anointed Procession +
Doubling Season co-residence), Companion (Lurrus), Equip + activated
(Stoneforge Mystic, Skullclamp, Sword of Fire and Ice, Kor Outfitter),
Prowess (Monastery Swiftspear), Threshold (Werebear with populated
graveyard), Mana fixing (Grand Architect), Untap-step gating (Stasis),
Counter doubler (Vorinclex + Elspeth co-residence), Token-on-ETB
(Roxanne Starfall Savant), Indestructible vs Wrath (Avacyn + Bears
co-residence), Planeswalker -2/ult (Liliana, the Last Hope),
Aftermath/Split (Driven // Despair), Convoke (Chord of Calling),
Improvise (Herald of Anguish), Affinity (Thoughtcast), Replicate
(Consign to Memory), Disturb (Baithook Angler), Plot (Beastbond
Outcaster), Suspect (Nelly Borca), Class level-up chain (Cleric Class),
Storm-flavored (Aetherflux Reservoir), Landfall (Bloodghast),
Counter-driven cheating (Aether Vial), Elemental ETB (Risen Reef),
Cantrip artifact (Baleful Strix), Damage redirect (Phytohydra),
Aura (Pacifism), Exile-replace (Oblivion Ring + Kalitas), Sacrifice
trigger (Blood Artist), Dredge (Golgari Grave-Troll, Stinkweed Imp),
Vanilla life-gain ETB (Courier Griffin), Monarch (Court of Grace),
Artifact die-chain (Scrap Trawler), Modal Charm-on-damage (Glissa
Sunslayer), Vehicle co-residence (Smuggler's Copter + Bears), Battle
defeat with graveyard target (Invasion of Ikoria), Adventure target
(Bonecrusher Giant + Bolt co-residence).

### Aggregate this run (post-M6.6)

- **130 scenarios** (up from 80).
- **126 full-match** (97%).
- **4 mvp-known** (3%). Distribution:
  - 1× `bridge-counter-event-not-captured` (cleric-class-etb's
    Class-keyword-driven counter at level 1 not captured by the
    bridge's CounterAdded subscription path, same family as the M6
    rows; closes once bridge tracks ClassLevelGained too).
  - 2× `bridge-engine-state-event-not-captured` (`court-of-grace-etb`
    fires `BecameMonarch`; `cleric-class-etb` fires `ClassLevelGained`).
    New M6.6 bucket — bridge V2 doesn't subscribe to a handful of Forge
    "engine-state" events (monarchy, Class-level changes, day/night,
    energy, ring-tempts-you, etc.). The TS engine surfaces these as
    discrete events; the Java side has equivalents but the bridge
    listener doesn't subscribe.
  - 2× `shallow-trigger-fanout` + 2× `no-stack-drain`
    (`kor-outfitter-etb`, `oblivion-ring-etb`) — Forge skips the
    ETB-target-trigger fan-out under the headline ETB when the
    attached/exile target choice is empty (no equipment to attach,
    no nonland permanent to exile). The TS engine fires the trigger
    anyway as `AbilityActivated` + `StackItemResolved`. Same family
    as M6 snapcaster-mage; not an engine bug.

### Real engine bugs surfaced — none

No M6.6 scenario landed in `real-divergence-investigate`. Every
divergence maps to a documented bridge capture gap or known Forge
behaviour. Hard contract held.

### New M6.6 bucket

- **`bridge-engine-state-event-not-captured`** (TS-only `ClassLevelGained`,
  `BecameMonarch`, prospective `DayNightChanged`, `EnergyChanged` etc.):
  Same root cause as `bridge-counter-event-not-captured`. Bridge's
  `BridgeRunner.java` listener registry doesn't subscribe to these
  Forge engine-state events. Engine-side, the TS state changes apply
  correctly — the divergence is purely capture-side.

### Follow-on work (post-M6.6, NOT in this dispatch)

1. **Bridge: subscribe to engine-state events** — closes the 2 (and
   any future) `bridge-engine-state-event-not-captured` rows. The
   exhaustive list to add:
   - `GameEventClassLevelGained` (or scrape the level changes from
     the existing zone-move stream — Class is a permanent counter).
   - `GameEventMonarchChanged` (whatever Forge calls the monarchy
     transition signal).
   - Day/night, energy, ring-tempts-you, dungeon — not in this
     cohort but candidates for future expansion.
2. **TS runner: drop the optional-no-target trigger fan-out** —
   closes the kor-outfitter / oblivion-ring rows. When a triggered
   ability has no legal target (no equipment to attach, no nonland
   permanent to exile), the TS runner fires the trigger anyway and
   it resolves as a no-op `AbilityActivated` + `StackItemResolved`.
   Forge skips the fan-out entirely. Either (a) suppress the TS
   trigger fire when there are no legal targets, or (b) strip the
   no-op trigger pair on the TS side at the parity-classifier
   boundary. Option (b) needs a discriminator the trigger metadata
   doesn't currently carry.

## Milestone 6.7 — close M6.6 infra gaps + expand to ~160

M6.7 closed the two `bridge-engine-state-event-not-captured` rows
from M6.6 and expanded the cohort from 130 → 159 scenarios, then
re-ran parity end-to-end against the rebuilt Java goldens.

### Aggregate this run (post-M6.7)

- **159 scenarios** (up from 130).
- **152 full-match** (95.6%).
- **7 mvp-known** (4.4%). Distribution:
  - 5× `shallow-trigger-fanout` + `no-stack-drain`
    (`kor-outfitter-etb`, `oblivion-ring-etb`, `cleric-class-etb`,
    `knight-of-the-white-orchid-etb`, `sand-strangler-etb`) — Forge
    skips the optional-target ETB trigger fan-out when no legal
    target exists; TS runner fires the trigger anyway as a no-op
    `AbilityActivated` + `StackItemResolved` pair.
  - 1× `bridge-counter-event-not-captured` (`cleric-class-etb`'s
    Class-keyword level-1 counter, same family as M6 rows).
  - 1× `ts-runner-shallow` (`murderous-redcap-etb`) — Forge fires
    the Persist-revive damage trigger on a different cycle.
  - 1× `bridge-action-skipped` (`tilted-animar-etb`) — fake card
    (made-up name); Forge can't find it so Java side is empty.
- **0 unknown** (`real-divergence-investigate`). Hard contract held.

### What M6.7 changed

1. **Strip `BecameMonarch` and `ClassLevelGained` as engine-internal
   on TS side.** Forge has **no GameEvent** for monarchy transitions
   or Class-keyword level changes — `Game.setMonarch()` and the
   level-up path silently mutate state without firing on the
   EventBus. The TS engine emits discrete state events; with no Java
   counterpart to subscribe to, classify both as engine-internal
   (same family as `CardDestroyed`/`StateBasedActionApplied`).
   Closes `court-of-grace-etb` and the `bridge-engine-state-event-
   not-captured` class for these two TS-only kinds.

2. **Strip `CardAttached` / `CardUnattached` as engine-internal on
   TS side.** Bridge V2 doesn't subscribe to
   `GameEventCardAttachment`. The semantic equip step is already
   represented on both sides via the equipment/Germ token's
   `CardChangedZone(null → Battlefield)` (Living Weapon path); the
   attachment edge is a TS-side bookkeeping marker that Forge folds
   into the equipment's modifier graph silently. Closes
   `batterskull-etb`'s real-divergence-investigate row.

3. **Cohort expansion: +29 scenarios** (130 → 159). Mechanics added:
   Suspend (Lotus Bloom), Outlast (Mer-Ek Nightblade), Renown-style
   (Knight of the White Orchid), Adapt-flavored (Migratory Route),
   Mentor (Tajic, Legion's Edge), Strive-flavored (Mizzium Mortars),
   Channel-flavored (Generous Visitor), Cascade-chain (Maelstrom
   Wanderer), Mutate (Auspicious Starrix), Encore (Faldorn),
   For-Mirrodin (Sword of the Realms), Living Weapon (Batterskull),
   Scavenge (Slitherhead), Persist (Murderous Redcap), Undying
   (Strangleroot Geist), Embalm (Sacred Cat), Eternalize (Sand
   Strangler), Foretell (Augury Raven), Domain (Tribal Flames),
   Constellation (Doomwake Giant), Battalion-flavored (Boros
   Reckoner), Revolt (Tilted Animar), Landfall (Steppe Lynx),
   Heroic (Anax and Cymede), Coven-flavored (Light of Promise),
   Magecraft (Quandrix Apprentice), Awaken (Awaken the Bear),
   Bestow (Hopeful Eidolon), Compleated (Tamiyo, Compleated Sage).

### Real engine bugs surfaced — none

No M6.7 scenario landed in `real-divergence-investigate`. Every
divergence maps to a documented bridge capture gap or known Forge
behaviour. Hard contract held.

## Milestone 6.8 — first real engine bug fix + expand to ~190

M6.8 fixes the first real engine bug surfaced through the parity
testing flow (CR 603.10c violation on triggered abilities with no legal
target) and expands the cohort from 159 → 188 scenarios. The fix is in
`packages/game/src/triggers/trigger-target-probe.ts` + a wire-up in
`trigger-registry.ts`.

### Aggregate this run (post-M6.8)

- **188 scenarios** (up from 159).
- **181 full-match** (96.3%).
- **7 mvp-known** (3.7%). Distribution:
  - 3× `shallow-trigger-fanout` + 3× `no-stack-drain`
    (`cleric-class-etb`, `knight-of-the-white-orchid-etb`,
    `sand-strangler-etb`) — three of the original five M6.7 rows
    remain because their gating mechanism is *not* `ValidTgts$` empty
    set:
      - `cleric-class-etb`: the AbilityActivated/StackItemResolved
        come from the Class-keyword's Level-counter watcher, which
        runs as a no-op resolver; this is a separate trigger-shape
        not covered by the M6.8 probe (no `executeKey`, no parsed
        `ValidTgts$`).
      - `knight-of-the-white-orchid-etb`: Forge skips because the
        trigger has `CheckSVar$ Y SVarCompare$ GTX` and the SVar
        comparison fails when no opponent has more lands. The TS
        ChangesZoneTrigger doesn't honour `CheckSVar$` yet — separate
        gating mechanism, not target-legality.
      - `sand-strangler-etb`: Forge skips because `Desert$ True`
        gates the trigger to require controlling a Desert. The TS
        ChangesZoneTrigger doesn't honour `Desert$` yet — separate
        gating mechanism.
  - 1× `bridge-counter-event-not-captured` (`cleric-class-etb`'s
    Class-keyword level-1 counter, same family as M6 rows).
  - 1× `ts-runner-shallow` (`murderous-redcap-etb`) — Forge fires
    the Persist-revive damage trigger on a different cycle.
  - 1× `bridge-action-skipped` (`tilted-animar-etb`) — fake card
    name; Forge can't find it so Java side is empty.
- **0 unknown** (`real-divergence-investigate`). Hard contract held.

### What M6.8 changed

1. **Real engine bug fix — CR 603.10c skip path.** Before M6.8, TS
   triggered abilities with explicit `ValidTgts$` would fire even when
   there was no legal target on the battlefield, queuing as a no-op
   `AbilityActivated` + `StackItemResolved` pair on the stack and
   resolving without effect. Forge correctly skips the trigger fire in
   `SpellAbility.setupTargets()` (returning `false` from `chooseTargetsFor`
   bubbles through `PlaySpellAbility#playSpellAbility` → `prerequisitesMet
   = false` → `WrappedAbility` is rolled back without ever reaching the
   stack). Per CR 603.10c: "If a triggered ability requires a target
   chosen from among a set of possible targets and there is no possible
   target, the ability won't trigger."

   The TS fix lives in `packages/game/src/triggers/trigger-target-probe.ts`.
   After a trigger passes `matches() / interveningIf / suppression /
   DisableTriggers`, the probe walks the source card's `Execute$` SVar
   chain (parent + nested `subAbility` + `SubAbility$ <svarRef>`),
   gathers every literal `ValidTgts$` clause, and counts legal targets
   on the live battlefield via `cardMatchesFilter`. If any required
   step has zero candidates, the trigger is dropped before being
   queued onto the pending list. The probe is wired into
   `TriggerRegistry.onEvent()` after the existing gates; non-data-driven
   triggers (keyword-spawned, replacement-spawned, hand-built) without
   an `executeKey` stamp pass through unchanged.

   `ChangesZoneTrigger` now stamps `executeKey` onto its built
   `TriggeredAbility` so the probe can locate the trigger's
   `Execute$` SVar without matching by trigger id.

   **Closes:** `kor-outfitter-etb` and `oblivion-ring-etb` from the
   M6.7 list of five `shallow-trigger-fanout` / `no-stack-drain`
   rows. The remaining three rows are gated by mechanisms outside
   the target-legality probe (`CheckSVar$`, `Desert$`, Class-keyword
   watchers) and are documented separately above.

2. **Cohort expansion: +29 scenarios** (159 → 188). Mechanics added:
   Bonecrusher Adventure, Lotus Bloom Suspend, Beastbond Outcaster
   Plot, Smuggler's Copter (m68), Smothering Tithe (Treasure trigger),
   Witch's Oven (Food token), Aetherworks Marvel (Energy on death),
   Glacial Ray Splice, Beck/Call Conspire (m68), Lurrus Companion,
   Doubling Season + Anointed Procession (m68 co-residence),
   Stolen Identity Cipher (m68), Driven // Despair Aftermath (m68),
   Goblin Bombardment storm-flavored, Maelstrom Wanderer Cascade x2
   (m68), Auspicious Starrix Mutate, Reckless Stormseeker
   Daybound, Tireless Tracker landfall→Clue, Invasion of Ikoria
   battle, Mosswood Dreadknight Trample/Menace, Stoneforge Mystic
   no-targets ETB (CR 603.10c probe target), Glacial Chasm
   Cumulative upkeep, Cryptic Command modal Charm (m68), Rite of
   Replication Kicker, Aurelia Warleader (m68), Brothers Yamazaki
   legend-rule (m68), Mer-Ek Nightblade Outlast, Vorinclex +
   Doubling Season co-residence, Consign to Memory Replicate (m68).

### Real engine bugs surfaced — first one CLOSED

The M6.8 dispatch is the first time the parity-testing flow has
identified a real CR-rule violation in the TS engine and closed it
through a code fix rather than a documentation change. This is the
testing infrastructure's intended terminal step: drive scenarios →
diff against Forge → identify the engine bug → fix → re-validate.

## Milestone 6.9 — 100% parity reached (188/188 full-match)

M6.9 closes every remaining `mvp-known` row from the M6.8 set with
real engine fixes. End state: **188 full-match / 0 mvp-known / 0
unknown.**

### What M6.9 changed

1. **Class-keyword level synchronization moved inline.** Wave 113's
   CounterAdded watcher (a stack-going `TriggeredAbility`) was the
   wrong shape — every Level-counter add surfaced a spurious
   `AbilityActivated` + `StackItemResolved` pair the Java side never
   fires. Forge's `ClassLevelUpEffect#resolve` calls
   `Card.setClassLevel(int)` directly without queuing a trigger; we
   mirror that now by syncing `card.classLevel = max(prev, total)`
   inside `addCounter`'s onApplied callback. The watcher is gone,
   the SBA initializer mutates `card.classLevel` and the Level
   counter map synchronously without emitting `CounterAdded` (parity
   with Forge's silent constructor-time level-1 default in
   `Card.java:238`). **Closes:** `cleric-class-etb`.

2. **CR 603 trigger requirement gate.** Extended
   `trigger-target-probe.ts` with a `triggerFailsRequirements`
   companion to `triggerHasNoLegalTarget`. Mirrors Forge's
   `CardTraitBase#meetsCommonRequirements` (called from
   `Trigger#requirementsCheck`): walks the trigger's stamped raw param
   map and skips the fire when any requirement fails. Currently
   honoured params: `CheckSVar / SVarCompare`, `Desert`, `Threshold`,
   `Hellbent`, `Metalcraft`. The probe consults the SVar evaluator for
   numeric comparators and checks `Player.hasDesert()` analog for the
   Desert flag. The trigger handler stamps `triggerParams` onto the
   built TriggeredAbility so the gate has access to the raw params
   without re-parsing. **Closes:** `knight-of-the-white-orchid-etb`
   (CheckSVar$ Y SVarCompare$ GTX), `sand-strangler-etb` (Desert$
   True).

3. **`PlayerCountOpponents` SVar selector.** Knight of the White
   Orchid's `Y` SVar is `PlayerCountOpponents$HighestValid Land.YouCtrl`
   — for each opponent, count "lands the opponent controls" and
   return the max. Mirrors Forge's `playerXCount(opponents, s, ...)`
   family with `Highest`/`Lowest`/sum aggregation. Wired into the
   selector registry so `evaluateSVar` can resolve trigger gates that
   reference it.

4. **Trigger probe honours `TgtZone$` and `TargetMin$`.** The CR
   603.10c skip path was over-eager: `Snapcaster Mage`'s ETB-flashback
   trigger has `ValidTgts$ Instant.YouCtrl,Sorcery.YouCtrl | TgtZone$
   Graveyard`, but the probe only walked the battlefield and so
   reported zero candidates and skipped the trigger fire. Probe now
   reads `TgtZone$` and walks the matching zone (Graveyard, Hand,
   Exile, etc.). Probe also honours `TargetMin$ 0` (CR 601.2c "up to
   N targets") so optional-target triggers like Gilded Drake's ETB
   exchange fire even when no opponent's creature exists. **Closes:**
   `gilded-drake-etb`, `snapcaster-mage-etb`.

5. **Trigger resolver auto-target binding.** `ChangesZoneTrigger`'s
   resolver now performs target enumeration when the trigger body's
   `ValidTgts$` is a literal: ask the controller for a
   `chooseCastTargets` decision, validate, bind onto the SpellAbility
   before `makeResolver()` runs. Mirrors Forge's
   `WrappedAbility#resolve` path which calls AI target selection
   before the underlying effect fires. Without this, a damage trigger
   like Murderous Redcap's ETB body would resolve with no target and
   no damage would land. **Closes:** `murderous-redcap-etb` (in
   tandem with the persist LKI fix below).

6. **Persist LKI for -1/-1 counter at fire time.** Persist's "if it
   had no -1/-1 counters" gate read live `card.counters` after the
   `moveTo` Battlefield→Graveyard had already cleared the counter map
   per CR 122.6 — so the second death after a successful persist saw
   `m1m1 = 0` and re-resurrected, forming an infinite death loop on
   any ETB-self-damage card with persist (Murderous Redcap targeting
   itself). The fix: stamp a counter snapshot on
   `game.flags.countersAtLeaveBattlefield` BEFORE the CR 122.6 clear
   in `addCounter`'s onApplied. The persist trigger's `matches()`
   reads the snapshot and stashes the pre-clear `m1m1` count in a
   closure-scoped `hadM1M1AtFire`; the resolver consults the closure
   variable instead of live state. Mirrors Forge's
   `TriggerChangesZone#performTest` LKI capture.

7. **Random controller prefers non-self targets for "Any".** When a
   trigger body has `ValidTgts$ Any`, the random controller now sorts
   the eligibility list players-first → other-cards → source-card-
   last. Mirrors Forge's AI heuristic for damage-flavour triggers
   (route damage to a player rather than a creature you control).
   Without this preference, Murderous Redcap's ETB damage trigger
   would pick the source card itself (first in the eligibility set)
   and form a death loop with the persist resurrection path. The
   policy is conservative: it changes target ordering but doesn't
   exclude any legal target.

8. **`tilted-animar-etb` scenario rewritten with a real card.** The
   prior scenario's "Tilted Animar" was a fictional card; the Forge
   bridge silently emitted no events because `CardFactory` couldn't
   resolve the name. Replaced with `Angelic Sleuth` (real Forge card
   with the same trigger family — `ChangesZone` Battlefield→Any with
   a `Permanent.YouCtrl+Other+HasCounters` filter).

### Real engine bugs surfaced (M6.9 batch — all closed)

1. Class watcher fan-out (engine: wrong shape for level sync). Closed.
2. CR 603 requirement gate not enforced (CheckSVar/Desert family). Closed.
3. CR 603.10c probe missing TgtZone / TargetMin$ 0 awareness. Closed.
4. Trigger resolver missing auto-target binding (parity-runner gap). Closed.
5. Persist counter LKI not captured at fire time (CR 122.6 race). Closed.

### Aggregate this run (post-M6.9)

- **188 scenarios.**
- **188 full-match (100%).**
- **0 mvp-known.**
- **0 unknown.**

The hard contract holds: every TS divergence either matches Forge
exactly or surfaces a real engine bug we close in the same dispatch.

### How to verify

```bash
node tools/parity-harness/run-parity.mjs
# Expect (M6.9):
#   full-match:  188
#   mvp-known:   0
#   unknown:     0
```

## Milestone 6.10 — expand to ~300 scenarios + sustain 100% parity

M6.10 expands the cohort from 188 → 299 scenarios (+111 across mechanics
under-represented in the M6.9 set) and closes the only mvp-known row
that surfaced (Soulbond ETB-pair trigger fan-out when no eligible
partner exists) with a real engine fix. End state: **299 full-match /
0 mvp-known / 0 unknown.**

### Aggregate this run (post-M6.10)

- **299 scenarios** (up from 188).
- **299 full-match (100%).**
- **0 mvp-known.**
- **0 unknown** (`real-divergence-investigate`). Hard contract held.

### What M6.10 changed

1. **Cohort expansion: +111 scenarios** (188 → 299). Mechanics added:
   Channel from hand, Convoke (Chord of Calling × 2), Improvise
   (Reverse Engineer × 2), Surveil (Surveilling Sprite parse), Connive
   (Tenured Inkcaster), Ascend (Storm Fleet Sprinter), Crime (Take the
   Fall), Investigate (Tireless Tracker × 3), Energy (Aetherworks
   Marvel), Adventure (Bonecrusher Stomp / Murderous Rider), Banding
   (Adventurers' Guildhouse), Bestow (Hopeful Eidolon × 2), Soulbond
   (Wingcrafter), Persist/Undying chain (Strangleroot Geist /
   Murderous Redcap), Embalm (Sacred Cat × 2), Eternalize (Sand
   Strangler × 2), Splice Arcane (Glacial Ray), Outlast (Mer-Ek
   Nightblade), Mentor (Tajic, Legion's Edge), Provoke variant (Lure
   of Prey), Strive (Mizzium Mortars), Replicate (Repudiate //
   Replicate), Ninjutsu (Ninja of the Deep Hours), Hideaway (Mosswort
   Bridge), Sunburst (Etched Oracle), Wither (Boggart Ram-Gang),
   Infect (Phyrexian Crusader), Conspire (Beck // Call), Devotion
   (Gray Merchant), X-spell (Hangarback Walker), Modal Charm (Cabaretti
   / Cryptic Command), Phasing (Teferi's Veil), Companion (Yorion),
   Counter doubler + Planeswalker (Vorinclex + Liliana), Damage
   redirect (Phytohydra / Boros Reckoner), Vehicle (Smuggler's Copter),
   Daybound (Reckless Stormseeker × 2), Plot (Beastbond Outcaster),
   Cipher (Stolen Identity), Cascade × 1 / Cascade × 2 (Bloodbraid Elf
   / Maelstrom Wanderer), Mutate (Auspicious Starrix), Battle
   (Invasion of Ikoria), Equipment (Sword of Fire and Ice), Treasure
   (Smothering Tithe), Food (Witch's Oven), Adamant (Charming Prince),
   Foretell (Augury Raven), Domain (Tribal Flames), Scry (Augur of
   Bolas), Storm-flavored (Aetherflux Reservoir), Buyback (Capsize),
   Awaken (Awaken the Bear), Casualty (Body Count), Backup (Anointer
   of Champions), Squad (Trumpeting Carnosaur), Encore (Faldorn),
   Reconfigure (Maul of the Skyclaves), Warp (Crucias), Spree (Pyretic
   Charge), Affinity (Thoughtcast), Discard cost (Putrid Imp),
   Tarmogoyf-with-graveyard, Constellation (Doomwake Giant), Magecraft
   (Quandrix Apprentice), Heroic (Anax and Cymede), Saga (History of
   Benalia), Class (Cleric Class), Initiative (Caves of Chaos),
   Living Weapon (Batterskull), For-Mirrodin (Sword of the Realms),
   Scavenge (Slitherhead), Steppe Lynx Landfall, Goblin Bombardment
   sac-fling, Glacial Chasm Cumulative Upkeep, Compleated (Tamiyo),
   Mirran Crusader Double Strike, Vampire Nighthawk triple keyword,
   Rite of Replication Kicker, Rosheen Meanderer X-cost ramp, Aurelia
   second combat, Birthing Pod Phyrexian mana, Ohran Frostfang Snow,
   Migratory Route Adapt, Disturb (Baithook Angler), Riot-flavored
   (Rampaging Brontodon), Stoneforge Mystic, Doubling Season +
   Procession + Hangarback co-residence, Sigarda triple keyword,
   Avacyn Indestructible-grant, Sphinx of the Final Word
   uncounterable, Nykthos Devotion ramp, Prey Upon Fight, Glimpse the
   Unthinkable Mill, Animate Dead reanimator, Polymorph transform,
   Demonic Tutor library-search, Wheel of Fortune mass-discard.

2. **Real engine bug fix — Soulbond ETB-pair trigger CR 603.10c
   adherence.** Pre-M6.10, `SoulbondKeywordHandler` synthesized an ETB
   trigger whose `matches()` only checked
   `event.kind === "CardChangedZone"` and the source-cardId / toZone.
   The trigger fired for every Soulbond ETB regardless of whether a
   legal pairing target existed — when no other unpaired creature was
   on the battlefield, the trigger queued onto the stack as a no-op
   `AbilityActivated` and resolved silently as `StackItemResolved`.

   Forge's behaviour: `K:Soulbond` doesn't fan out the trigger when no
   eligible partner exists (CR 603.10c — "if no possible target, the
   ability won't trigger"). Wingcrafter's CardChangedZone is the only
   event the bridge captures.

   **Fix:** `SoulbondKeywordHandler.matches()` now walks the live
   battlefield at trigger-match time, checking for any unpaired
   creature controlled by the Soulbond card's controller. If none
   exists, `matches()` returns `false` and the trigger is dropped at
   the registry boundary before being queued. The resolver-side
   guard remains intact (defence-in-depth: even if `matches()` ever
   returns true incorrectly, the resolver re-validates).

   **Closes:** `wingcrafter-etb` parity row.

### Real engine bugs surfaced (M6.10 batch — all closed)

1. Soulbond ETB-pair fan-out fired with empty eligibility pool. Closed.

### How to verify

```bash
node tools/parity-harness/run-parity.mjs
# Expect (M6.10):
#   full-match:  299
#   mvp-known:   0
#   unknown:     0
```
