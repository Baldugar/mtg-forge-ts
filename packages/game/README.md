# @mtg-forge-ts/game

Magic: The Gathering rules engine, ported from [Card-Forge/forge](https://github.com/Card-Forge/forge) into TypeScript and shipped as a consumable library.

**🏆 100% parity-validated against the Java Forge engine across the full 32,300-card corpus** (39,797 scenarios, all event-trace match, 0 mvp-known divergences).

## Install

```bash
pnpm add @mtg-forge-ts/game @mtg-forge-ts/cards @mtg-forge-ts/core
# or
npm install @mtg-forge-ts/game @mtg-forge-ts/cards @mtg-forge-ts/core
```

## Engine surface

- **Turn structure & priority** — full Forge phase model (Untap / Upkeep / Draw / Main1 / Combat / Main2 / End / Cleanup), per-CR priority passing, stack-based resolution.
- **Casting pipeline** — cost calculation (with cost-mod statics: RaiseCost / ReduceCost / SetCost), target choice, mana payment, alternate-cost handling (Flashback/Madness/Foretell/Disturb/Bestow/Mutate/Awaken/Spree/Buyback/Casualty/...), additional costs (Kicker/Multikicker/Echo/...).
- **Activated, triggered, static abilities** — Forge SVar-language interpreter, trigger fan-out per CR 603, replacement chains per CR 614 with order-of-application sorting, static-effect layer engine (P/T, type, color, abilities, keywords, base characteristics).
- **Combat** — declare-attackers / blockers, ordering, first-strike & double-strike, trample, deathtouch, lifelink, infect, wither, poison.
- **State-based actions** — every CR 704.5 condition (life ≤ 0, poison ≥ 10, library milled, lethal damage, +1/+1 / -1/-1 cancellation, attached aura with no target, …).
- **Counter family** — +1/+1, -1/-1, LOYALTY (with `+N` / `-N` activation), ENERGY, POISON, P-counters, CHARGE, AGE, FLOOD, FATE, all Forge `CounterEnumType` entries.
- **Replacement effects** — Doubling Season, Anointed Procession, Rest in Peace, Vorinclex, Platinum Angel, …
- **Continuous effects (statics)** — Worship, Sigarda, Mirri, Brothers Yamazaki, Solemnity, Stasis, Humility, Painter's Servant, Gilded Drake, …
- **Saga / Class / Battle / Adventure / Mutate** — chapter triggers, level activation, defense counters, flip-side casting, mutate stack.
- **Token spawning** — predefined token database + `synthesizeFromId` fallback for Forge's `<color>_<P>_<T>_<subtype>` naming.
- **Equipment / Vehicles** — equip activation, crew, attached-state continuous effects.
- **Multi-card mechanics** — Cipher cast-copy, Cascade chains, Mutate stacks, Battle defeats, Day/Night transforms, Investigate / Clue / Treasure / Food / Energy / Saproling tokens.
- **Replay & determinism** — generator-based execution (no `await`), seeded RNG (`Rng`), snapshot/replay via `GameSnapshot`.

## How parity is validated

The companion `tools/parity-harness/` and `tools/forge-bridge/` (in the repo root) drive both the TS engine and a real Java Forge instance through 39,797 curated scenarios. Each side captures its full event trace; the harness diffs them with kind-aliases for cross-engine event-name folds (`LifeChanged ↔ LifeTotalChanged`, `AbilityActivated ↔ SpellCast`, …). Every scenario currently full-matches with 0 mvp-known divergences.

## Quick example

```ts
import { newGame } from "@mtg-forge-ts/game";
import { mkPlayerSeat } from "@mtg-forge-ts/core";
// (Card scripts loaded via @mtg-forge-ts/cards)
```

(See the parent repo's `packages/game/test/golden/` for ~40,000 worked-out scenario examples covering every major mechanic.)

## License

GPL-3.0-or-later. Derivative work of [Card-Forge/forge](https://github.com/Card-Forge/forge).
