# mtg-forge-ts

A TypeScript port of the [Card-Forge/forge](https://github.com/Card-Forge/forge) Magic: The Gathering rules engine, reshaped as a consumable library rather than a GUI application.

**Status:** Design phase — specifications complete, implementation not yet started.

## What this is

A headless library that provides the full Magic rules engine, 32,303+ card definitions, all 15 game formats (constructed + limited), Forge-equivalent AI, deterministic replay, save/load, and network-authoritative multiplayer capability — all accessible via a programmatic TypeScript API.

Intended for Node.js runtimes with a pluggable loader seam for future browser adapters. Not a GUI; consuming apps own rendering, asset fetching, network transport, and persistence.

## What this isn't

- A graphical MTG client. No rendering, no card images, no UI.
- A replacement for Forge. This is an independent port that shares card data and licensing; upstream Forge remains the authoritative reference.
- Affiliated with Wizards of the Coast. Magic: The Gathering is a trademark of Wizards of the Coast LLC. This project is unofficial.

## Documentation

All design specifications live in [`docs/superpowers/specs/`](docs/superpowers/specs/).

Start with [`2026-04-23-mtg-forge-ts-master-spec.md`](docs/superpowers/specs/2026-04-23-mtg-forge-ts-master-spec.md) for the architecture overview, then dive into sub-project specs (`sp0` through `sp8`) for area-specific details.

## License

GPL-3.0-or-later (derivative work of Card-Forge/forge, which uses the same license).

Monetization of consuming apps is unrestricted; distributed derivative works must also be GPL-3.0-or-later.

Attribution and upstream credits are tracked in `NOTICE`.
