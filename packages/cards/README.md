# @mtg-forge-ts/cards

Forge card-DSL parser + structural validator + token database for the [mtg-forge-ts](https://github.com/Baldugar/mtg-forge-ts) rules engine.

## Install

```bash
pnpm add @mtg-forge-ts/cards @mtg-forge-ts/core
# or
npm install @mtg-forge-ts/cards @mtg-forge-ts/core
```

## What's inside

### Parser

Walks Forge's `forge-gui/res/cardsfolder/*.txt` line-format and produces typed `CardDefinition` ASTs ready to feed `@mtg-forge-ts/game`.

Coverage:
- **`Name:` / `ManaCost:` / `Types:` / `PT:` / `Loyalty:` / `Defense:` / `Colors:`** — printed-card characteristics, including Forge's Avatar alt-cost mana-slot (`Waterbend<5>`).
- **`K:`** — full keyword registry (Flying, Trample, Hexproof, ETB-counter, Chapter, Job select, Class, Saga, Backup, Mutate, Modular, Riot, Echo, Evoke, Fading/Vanishing, Persist, Undying, Wither, Haunt, For Mirrodin, Reconfigure, Suspect, Friends forever, Adapt, Monstrosity, Unleash, Exploit, Bestow, Outlast, Surge, Recover, Renown, Awaken, Bolster, Manifest, Megamorph, Tribute, Improvise, Convoke, Delve, Encore, Casualty, Buyback, Spree, Warp, Plot, …).
- **`A:` / `S:`** — activated, spell, and static abilities.
- **`T:`** — triggered abilities (ChangesZone, ChangesZoneAll, Mode$ Always, Phase, Attacks, BecomesTarget, DamageDone, Exploited, FullyUnlock, …).
- **`R:`** — replacement effects.
- **`SVar:`** — Forge SVar-language bindings (literals, abilities, expressions).
- **Multi-face** — `ALTERNATE` separator + `AlternateMode:` (DFC / MDFC / Saga-creature flip / Adventure / Disturb).

### Validator

Structural validator (`tools/dsl-validator/`) that walks the full corpus and verifies each card's parser output is well-formed against the AST schema.

### Token database

Predefined `tokenDatabase` map of Forge's canonical `TokenScript$` ids → `TokenEntry` (color/types/PT/keywords/abilities). When a script names a token id not in the database, `synthesizeFromId` parses Forge's `<color>_<P>_<T>_<subtype1>[_<subtype2>...][_<keyword>...]` convention as a fallback (`a` token between colors and stats marks Artifact creatures, `c` is colorless).

Core entries: w_1_1_soldier, w_1_1_human_soldier, w_1_1_human, u_1_1_bird_flying, u_1_1_merfolk, u_3_2_reflection, b_1_1_zombie, b_1_1_harpy_flying, r_1_1_goblin, g_3_3_beast, w_1_1_ally, c_1_1_a_servo, c_a_treasure_sac, …

## License

GPL-3.0-or-later. Derivative work of [Card-Forge/forge](https://github.com/Card-Forge/forge).
