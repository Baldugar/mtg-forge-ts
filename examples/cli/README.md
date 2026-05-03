# mtg-forge-ts-cli

Reference CLI consumer for the [@mtg-forge-ts](../../README.md) packages.
This example lives under `examples/`, is marked `private: true`, and is **not
published to npm**. Copy the directory wholesale into your own repo and adapt
it as a starting template for tools that drive the engine.

It demonstrates three entry points into the public API:

| Command                              | Demonstrates                                              |
| ------------------------------------ | --------------------------------------------------------- |
| `parse <card.txt>`                   | `parseCard()` from `@mtg-forge-ts/cards`                  |
| `validate-deck <deck.json> <format>` | `validateDeck()` from `@mtg-forge-ts/cards`               |
| `demo-game`                          | Minimal `Game` construction from `@mtg-forge-ts/game`     |

## Build & run

From the repo root:

```bash
# Build all workspace packages first (cards/core/game compile to dist/).
pnpm -r run build

# Run the CLI directly via tsx (no build step):
pnpm --filter mtg-forge-ts-cli dev parse path/to/card.txt

# Or build the CLI itself and run the compiled JS:
pnpm --filter mtg-forge-ts-cli build
node examples/cli/dist/index.js parse path/to/card.txt
```

## Sample card

Save the following as `lightning_bolt.txt` and run
`pnpm --filter mtg-forge-ts-cli dev parse lightning_bolt.txt`:

```
Name:Lightning Bolt
ManaCost:R
Types:Instant
A:SP$ DealDamage | Cost$ R | NumDmg$ 3 | ValidTgts$ Any | SpellDescription$ CARDNAME deals 3 damage to any target.
Oracle:Lightning Bolt deals 3 damage to any target.
```

Expected output:

```
Parsed: .../lightning_bolt.txt
Name:         Lightning Bolt
Types:        Instant
Mana cost:    R
Abilities:    1
Triggers:     0
Replacements: 0
Statics:      0
Keywords:     0
SVars:        0
Oracle:       Lightning Bolt deals 3 damage to any target.
```

## Sample deck

Save as `mono_red.json` and run
`pnpm --filter mtg-forge-ts-cli dev validate-deck mono_red.json modern`:

```json
[
  { "name": "Lightning Bolt", "count": 4 },
  { "name": "Monastery Swiftspear", "count": 4 },
  { "name": "Goblin Guide", "count": 4 },
  { "name": "Eidolon of the Great Revel", "count": 4 },
  { "name": "Bonecrusher Giant", "count": 4 },
  { "name": "Dragon's Rage Channeler", "count": 4 },
  { "name": "Ragavan, Nimble Pilferer", "count": 4 },
  { "name": "Lava Spike", "count": 4 },
  { "name": "Skewer the Critics", "count": 4 },
  { "name": "Light Up the Stage", "count": 4 },
  { "name": "Mountain", "count": 20 }
]
```

A wrapper shape is also accepted:

```json
{ "entries": [ { "name": "Mountain", "count": 60 } ] }
```

`validate-deck` exits `0` for legal decks and `1` for illegal decks (handy in
scripts).

## Layout

```
examples/cli/
├── package.json       # private workspace package, depends on @mtg-forge-ts/* via workspace:*
├── tsconfig.json      # extends ../../tsconfig.base.json
├── src/index.ts       # entry point with parse / validate-deck / demo-game
└── README.md          # this file
```
