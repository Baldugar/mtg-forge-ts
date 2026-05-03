# @mtg-forge-ts/core

Core types, views, RNG, events, and decisions for the [mtg-forge-ts](https://github.com/Baldugar/mtg-forge-ts) rules engine.

The deterministic value-domain layer the engine builds on. Mirrors the shape of Forge's Java types so card scripts, snapshots, and event traces are wire-compatible.

## Install

```bash
pnpm add @mtg-forge-ts/core
# or
npm install @mtg-forge-ts/core
```

## What's inside

- **`EntityId` / `PlayerSeat`** — branded numeric ids for cards / players. Constructors `mkEntityId(n)`, `mkPlayerSeat(n)`.
- **`ZoneType`** — mirrors `forge.game.zone.ZoneType` (Battlefield, Hand, Library, Graveyard, Exile, Stack, Command, SchemeDeck, PlanarDeck, AttractionDeck, ContraptionDeck, Sideboard, Subgame, ExtraHand, None, OutsideTheGame, Ante, Junkyard, Merged).
- **`CounterType`** — mirrors `forge.game.card.CounterEnumType` (P1P1, M1M1, LOYALTY, ENERGY, POISON, CHARGE, AGE, FLOOD, …).
- **`Color` / `ColorSet`** — five-color enum + ordered-set value type with WUBRG iteration.
- **`ManaCost` / `ManaSymbol`** — Forge-canonical parser/printer. Recognises Forge alt-cost mana-slots (Avatar `Waterbend<5>`, `Earthbend<3>`, `no cost`) as `NO_COST` so non-mana costs route to dedicated handlers without throwing.
- **`Cost` / `CostPart`** — cost-payment registry. ~30 cost parts: Tap/Untap, Sacrifice, Discard, PayLife, Exile (from any zone), AddCounter / RemoveCounter / RemoveAnyCounter, Mill, Forage, PayEnergy, Reveal, Return, Damage, Behold / BeholdExile, Blight, ChooseColor / ChooseCreatureType / ChooseCard, CollectEvidence, Enlist, Exert, ExiledMoveToGrave, ExileFromStack, FlipCoin, GainControl, GainLife, PayShards, PromiseGift, PutCardToLib, PutCounter, RollDice, TapType / UntapType, Unattach, Waterbend.
- **`CardDefinition`** — Forge characteristics shape: `name`, `oracle`, `types`, `manaCost`, `pt`, `colors`, `abilities`, `triggers`, `replacements`, `statics`, `keywords`, `svars`.
- **`SVarAst` / `Expression` / `ParamValue`** — typed AST for Forge SVar-language expressions (literals, references, arithmetic, selector-arg patterns).
- **`LKI`** — last-known-information snapshot type. Used by replacement / trigger / SBA paths to evaluate against the state right before an action.
- **`PaperCard`** — printed-card data shape with `definition: CardDefinition`, set + collector + language + foil + flags.
- **`KeywordId`** — registry of all known keyword identifiers + display-name → id resolution.
- **Engine errors** — structured hierarchy: `GameStateIntegrityError`, `IllegalDecisionError`, `ManaParseError`.

## Stability

This is the foundational layer for `@mtg-forge-ts/cards` and `@mtg-forge-ts/game`. The exported API is considered stable for v1.x.

## License

GPL-3.0-or-later. Derivative work of [Card-Forge/forge](https://github.com/Card-Forge/forge).
