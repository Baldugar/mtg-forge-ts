# forge-bridge — Milestone 3 Java parity bridge (MVP)

A small Java subproject that wraps Forge's `Game` class so the TS test
harness can run the same `GoldenScenario` JSON through Forge's actual
engine and capture an event-trace for parity comparison against our
Milestone-2 TS goldens.

> **Status:** MVP. Compiles + captures parity goldens for the M2 30-card
> cohort. Trigger fan-out (e.g. Mulldrifter's "draw two", Soul Warden's
> "gain 1 life") is not yet captured — only the primary `moveTo` /
> `SpellCast` event lands. See **Limitations** below.

## How it works

`BridgeRunner.java` (in `forge.bridge` package):

1. Reads `GoldenScenario` JSON from stdin.
2. Initializes Forge via `FModel.initialize(...)` exactly like Forge's
   own `AITest` test base class does.
3. Builds an empty AI vs AI `Game` (two `LobbyPlayerAi` players, empty
   decks, `GameStage.Play`, `MAIN1`).
4. Seeds player state from the scenario:
   - `life` — `Player.setLife(...)`
   - `battlefield` — `addCardToZone(name, p, Hand)` then
     `GameAction.moveTo(Battlefield, c, ...)` so triggers / statics /
     replacements register through the canonical pipeline.
   - `hand` — `addCardToZone(name, p, Hand)` directly.
   - `graveyard` — `addCardToZone(name, p, Graveyard)` directly.
5. Subscribes a Guava `EventBus` listener (the `TraceRecorder` inner
   class) to capture every `GameEvent*` Forge fires.
6. Walks the scenario's `actions` array, mapping each kind:
   - `etb`        → `addCardToZone(name, Hand)` then
                    `GameAction.moveTo(Battlefield)` then drain triggers
                    + state-effects + stack.
   - `cast`       → push first SpellAbility of the named hand card onto
                    `MagicStack`. AI controller resolves targeting.
   - `resolveTopOfStack` → loop `mainLoopStep` until stack empty.
   - `activate`   → push the activated ability at `abilityIndex` onto
                    the stack.
7. Emits the captured trace as JSON on stdout.

The trace shape mirrors `packages/game/test/golden/types.ts`'s
`GoldenTrace` so the parity-diff harness in M4 can compare both sides
structurally:

```json
{
  "scenarioId": "...",
  "seed": <number>,
  "engineVersion": "forge-bridge-mvp-0.1.0",
  "events":      [<GoldenEvent>...],
  "setupEvents": [<GoldenEvent>...]
}
```

## Required Forge build

The bridge runs against the **fat jar** Forge produces during a normal
build:

```
forge/forge-gui-desktop/target/forge-gui-desktop-2.0.12-SNAPSHOT-jar-with-dependencies.jar
```

To produce it from a fresh Forge clone:

```bash
git clone https://github.com/Card-Forge/forge.git
cd forge
mvn -DskipTests package
# -> forge-gui-desktop/target/forge-gui-desktop-*-jar-with-dependencies.jar
```

You also need the `forge-gui/res/` directory at runtime — it ships with
the Forge source tree (not in the jar). The bridge expects to be invoked
with **cwd = `forge/forge-gui/`** so that `res/cardsfolder/`,
`res/languages/`, etc. resolve relative to the working directory. (This
is a quirk of Forge's `BuildInfo.getVersionString()` returning
`"2.0.12-SNAPSHOT"` instead of `"GIT"`, which short-circuits the
`getAssetsDir()` development override.) `scripts/run.sh` handles the
chdir for you.

## Build

```bash
cd tools/forge-bridge
scripts/build.sh
```

This compiles `BridgeRunner.java` + `MiniJson.java` against the Forge
fat jar into `build/`. The script auto-detects the fat jar at
`../../../forge/forge-gui-desktop/target/...`; override with
`FORGE_JAR=/abs/path/to/jar` if your layout differs.

## Run a single scenario

```bash
scripts/run.sh path/to/scenario.json path/to/trace.json
```

`run.sh` chdirs to `forge/forge-gui/` before invoking the JVM so the
relative-path Forge resources resolve. It accepts either two arguments
(input scenario file, output trace file) or stdin/stdout in pipe mode.

## Capture the M2 30-card cohort

```bash
# 1. Export the TS-side scenarios to JSON (one-time per scenario set
#    update). Run from the repo root.
npx tsx tools/forge-bridge/scripts/export-scenarios.mjs

# 2. Run them all through the bridge. From tools/forge-bridge/:
for sc in scenarios/*.scenario.json; do
  name=$(basename "$sc" .scenario.json)
  scripts/run.sh "$sc" "__golden_java__/$name.golden.java.json"
done
```

## Limitations (MVP scope)

Documented so they don't surprise you when reading captured goldens:

- **Trigger fan-out is shallow.** When an ETB triggers (e.g. Mulldrifter
  draws two cards, Soul Warden gains 1 life), our trace currently shows
  only the primary `CardChangedZone` for the ETB itself. The triggered
  ability registers but its on-stack resolution doesn't fully drain
  through the simplified `mainLoopStep` we drive. This is a known gap;
  fixing it requires deeper integration with Forge's phase / priority
  loop and likely a custom `PlayerController` that auto-confirms "may"
  triggers. Tracked for post-MVP.
- **AI picks targets, not the scenario.** For `cast` actions the bridge
  pushes the SpellAbility onto the stack but lets Forge's AI controller
  pick targets. The TS scenario's `target: { kind: "card", name: "..." }`
  is **not** bound on the Java side. A future iteration should inject
  scripted targets via `sa.setTargetCard(...)` before stack-add.
- **Cost is not paid.** Spells are cast for free (`stack.add(sa)`
  bypasses cost payment). This means we don't capture `ManaSpent` /
  `CostPaid` events. Acceptable for MVP — divergence in cost-payment
  ordering is rare and not the highest-value parity signal.
- **One turn, MAIN1 only.** Every action runs in turn 1, MAIN1, on
  player 0. Multi-turn scenarios (Sulfuric Vortex over multiple upkeeps)
  would need full phase progression.
- **Setup events are bucketed separately.** The `setupEvents` array
  contains the moveTo events from seeding the battlefield. The action
  parity comparison should look at `events` only.

## Mapping: Forge events ↔ TS events

| Forge `GameEvent*`            | Bridge trace `kind`         | Notes |
| ----------------------------- | --------------------------- | ----- |
| `GameEventCardChangeZone`     | `CardChangedZone`           | Includes `cardName`, `cardId`, `fromZone`, `toZone`. |
| `GameEventSpellAbilityCast`   | `SpellCast`                 | Triggers, activations, and spells all share this event in Forge — payload `description` distinguishes them. |
| `GameEventSpellResolved`      | `StackItemResolved`         | `hasFizzled` boolean. |
| `GameEventCardDamaged`        | `DamageDealt`               | Card target. Forge's `DamageType` enum = Normal/M1M1Counters/Deathtouch/LoyaltyLoss. |
| `GameEventPlayerDamaged`      | `DamageDealt`               | Player target; `isCombat` boolean. |
| `GameEventPlayerLivesChanged` | `LifeTotalChanged`          | `oldLife` / `newLife`. |
| `GameEventCardTapped`         | `CardTappedChanged`         | |
| `GameEventLandPlayed`         | `LandPlayed`                | |
| `GameEventTurnPhase`          | `PhaseChanged`              | |
| (others)                      | (dropped via `DeadEvent`)   | We subscribe selectively; unmapped events route to the silent dead-letter sink. |

The TS `GoldenEvent.kind` taxonomy doesn't 1:1 match Forge's because
each engine has its own internal granularity (e.g. our `CardTargeted` +
`CrimeCommitted` events have no Forge counterpart since Forge folds
those into the SpellAbility cast pipeline). The parity-diff harness in
M4 will normalize both sides into a comparable canonical form.

## Files

```
tools/forge-bridge/
├── README.md                        — this file
├── scripts/
│   ├── build.sh                     — compile BridgeRunner against fat jar
│   ├── run.sh                       — invoke bridge with cwd=forge-gui/
│   └── export-scenarios.mjs         — TS GoldenScenarios → JSON
├── src/main/java/forge/bridge/
│   ├── BridgeRunner.java            — main entry + event recorder
│   ├── MiniJson.java                — zero-dep JSON parser+writer
│   └── BundleProbe.java             — diagnostic for Localizer issues
├── scenarios/                       — exported M2 scenario JSON (30 files)
├── __golden_java__/                 — captured Java goldens (30 files)
└── build/                           — compiled .class output
```

## Troubleshooting

- **`MissingResourceException: Can't find bundle for base name en-US`**
  — cwd isn't `forge/forge-gui/`. Use `scripts/run.sh` (which chdirs
  for you) or set the cwd manually.

- **`NoClassDefFoundError: forge.gui.GuiBase`** — fat jar missing from
  classpath. Set `FORGE_JAR` env var to the absolute path.

- **`ClassNotFoundException: forge.bridge.BridgeRunner`** — `build/` is
  empty. Run `scripts/build.sh` first.

- **Card not found** (e.g. "Card name X failed to parse") — Forge's
  card database doesn't have that name in its corpus. The TS engine
  ships with Forge's full corpus of `cardsfolder/*.txt`; the bridge
  reads the same files via Forge's loader. If a custom card fails,
  check `forge-gui/res/cardsfolder/`.
