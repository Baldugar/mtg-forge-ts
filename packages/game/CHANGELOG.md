# @mtg-forge-ts/game

## 1.0.0

Initial public release. **100% parity-validated against the Java Forge engine across the full 32,300-card corpus** (39,797 scenarios, all event-trace match, 0 mvp-known divergences).

Engine surface: full Magic rules engine — turn structure, priority, stack, mana pool, casting pipeline, activated/triggered/static abilities, replacement effects, state-based actions, layer engine (P/T, type, color, abilities, keywords), continuous effects, counter management, combat, damage replacement, lifelink/deathtouch/wither/infect/trample, planeswalker loyalty, saga lore, battle defense, attachment legality, generator-based action execution, deterministic RNG, snapshot-based replay.

Engine fixes shipped:
- `Targeted$<Property>` selector — supports `CardPower` / `CardToughness` / `CMC` accessors via `layerEngine.computeCharacteristics`. (Was numeric-index-only.)
- `GainLifeEffect` honours `Defined$` — life-gain routes to `TargetedController` / `Targeted` / `Opponent` / `You`. Closes Swords to Plowshares' "exile + opp gains life equal to target's power" sub-ability.
- `TokenEffect` parses comma-separated `TokenScript$` (e.g. `w_1_1_human,u_1_1_merfolk,r_1_1_goblin`) and falls back to `synthesizeFromId` parsing of Forge's `<color>_<P>_<T>_<subtype>` naming convention when an id isn't in the predefined database.
- `parseCostParamSymbols` (RaiseCost/ReduceCost) gracefully short-circuits on alt-cost expressions in `Cost$` field — was throwing on `Discard<X/Creature>`, `Sac<1/Land>`, `tapXType<>`, `BeholdExile<>`, `ChooseCard<>`, `AddCounter<>` etc.

Companion bridge improvements (in the parent repo):
- Bridge V6 — persistent JVM server mode, ~260× capture speedup vs cold-start per scenario.
- Bridge V7 — synthetic `PlayerLost` emission for life ≤ 0 / poison ≥ 10 (Forge's `GameEventGameOutcome` only fires at full match end).
