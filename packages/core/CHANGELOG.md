# @mtg-forge-ts/core

## 1.0.0

Initial public release.

Core types, views, RNG, events, and decisions for mtg-forge-ts. Provides the deterministic value-domain layer the engine builds on: discriminated `EntityId` / `PlayerSeat` brand, `ZoneType` / `CounterType` / `Color` enums (mirroring Forge's `forge.game.zone.ZoneType` / `forge.game.card.CounterEnumType`), Forge-canonical `ManaCost` / `ManaSymbol` parser & printer, the cost-part registry, the Forge characteristics shape, the SVar AST, the `LKI` snapshot type, layer-effect taxonomy, `PaperCard` data shape, the `KeywordId` registry, and the structured engine-error hierarchy.

Engine fix shipped: `ManaCost.parse` recognises Forge alt-cost mana-slots (Avatar bending costs `Waterbend<5>`, `Earthbend<3>` etc., and `no cost` sentinels) as `NO_COST` so non-mana costs route to dedicated handlers without throwing.
