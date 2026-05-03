# Contributing to mtg-forge-ts

## License

This project is GPL-3.0-or-later. Contributions are accepted under the same license.

## Developer Certificate of Origin

By contributing, you certify that you agree to the [DCO](https://developercertificate.org/).
Every commit must include a `Signed-off-by:` trailer. Use `git commit -s` (or configure
`.gitmessage` — see below).

## Commits

- Conventional Commits format: `feat:`, `fix:`, `refactor:`, `test:`, `docs:`, `chore:`, `ci:`, `sync:`.
- Every source file begins with `// SPDX-License-Identifier: GPL-3.0-or-later`.
- No emojis in code or docs.

## Commit template

Configure once: `git config commit.template .gitmessage`

## Releases (Changesets)

This repo uses [`@changesets/cli`](https://github.com/changesets/changesets) to manage versioning and npm publishing across the three published packages (`@mtg-forge-ts/core`, `@mtg-forge-ts/cards`, `@mtg-forge-ts/game`). When you land a user-facing change, run `pnpm changeset` and follow the prompts to author a release note (it writes a Markdown file under `.changeset/` describing the affected packages and bump kind: `patch` / `minor` / `major`). Maintainers later run `pnpm version` to consume those files (bumping `package.json` versions and updating each package's `CHANGELOG.md`), then `pnpm release` to build all packages and publish them to npm with public access. Internal cross-package dependencies are bumped with `patch` automatically.
