# @mtg-forge-ts/cards

## 1.0.0

Initial public release. Forge card-DSL parser + structural validator for mtg-forge-ts.

The parser walks Forge's `forge-gui/res/cardsfolder/*.txt` line-format and produces typed `CardDefinition` ASTs ready to feed the `@mtg-forge-ts/game` engine. Coverage:
- Mana cost line (`ManaCost:`) — with Avatar alt-cost mana-slot handling.
- Type line (`Types:`) — supertypes/types/subtypes via em-dash split.
- P/T / Loyalty / Defense (`PT:` / `Loyalty:` / `Defense:`).
- Color line (`Colors:`).
- Keyword (`K:`) — full keyword registry (Flying, Trample, Hexproof, ETB-counter, Chapter, Job select, Class, Saga, Backup, Mutate, etc.).
- Activated/spell/static abilities (`A:`/`S:`).
- Triggered abilities (`T:`).
- Replacement effects (`R:`).
- SVar bindings (`SVar:`).
- Multi-face cards via `ALTERNATE` separator + `AlternateMode:`.

Plus a token database (`tokenDatabase`) with predefined token entries plus a `synthesizeFromId` fallback that parses Forge's `<color>_<P>_<T>_<subtype>...` convention. New entries this release: `w_1_1_human`, `u_1_1_merfolk`, `b_1_1_harpy_flying`, `u_3_2_reflection`, `w_1_1_ally`.
