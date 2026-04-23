# SP1 — Engine Foundations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bootstrap the monorepo and build `@mtg-forge-ts/core` (full) plus `@mtg-forge-ts/game` (scaffold) so a scripted no-op game runs end-to-end and every other sub-project can build on top.

**Architecture:** Two packages in a pnpm monorepo. `core` holds pure data types (IDs, enums, mana/cost/deck, DSL AST, Rng, views, event+decision unions, errors). `game` holds the engine skeleton (Game, Player, Card, Zone, GameAction, PhaseHandler, Stack, ManaPool, Match, registry stubs) with generator-based suspendable execution. All state is ID-referenced + serializable. All randomness flows through an injected `Rng`.

**Tech Stack:** TypeScript 5.x strict / Node 20 LTS / pnpm workspaces / tsup (ESM+CJS) / vitest / fast-check / biome / changesets / lefthook.

**Spec references:** Master `docs/superpowers/specs/2026-04-23-mtg-forge-ts-master-spec.md`. SP1 `docs/superpowers/specs/2026-04-23-mtg-forge-ts-sp1-engine-foundations.md`.

**Conventions:**
- Every task follows TDD: failing test → run red → impl → run green → commit.
- Every commit has DCO sign-off (`git commit -s`) and Conventional Commit prefix (`feat:`, `fix:`, `refactor:`, `test:`, `docs:`, `chore:`).
- Every source file begins with `// SPDX-License-Identifier: GPL-3.0-or-later`.
- No emojis in code or docs.
- Class-based Forge-faithful port; ID references (no pointer cycles); no ambient randomness (no `Math.random`, `Date.now`, `crypto.randomUUID` in `@mtg-forge-ts/game` — `core` is looser because it has no runtime state).

---

## Milestone A — Monorepo Bootstrap

### Task 1: Root-level tooling config

**Files:**
- Create: `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`, `biome.json`, `lefthook.yml`, `.editorconfig`

- [ ] **Step 1:** Create `package.json` at repo root:

```json
{
  "name": "mtg-forge-ts",
  "private": true,
  "version": "0.0.0",
  "license": "GPL-3.0-or-later",
  "packageManager": "pnpm@9.12.0",
  "engines": { "node": ">=20.0.0" },
  "scripts": {
    "build": "pnpm -r run build",
    "test": "pnpm -r run test",
    "test:unit": "pnpm -r run test:unit",
    "typecheck": "pnpm -r run typecheck",
    "lint": "biome check .",
    "lint:fix": "biome check --write .",
    "format": "biome format --write ."
  },
  "devDependencies": {
    "@biomejs/biome": "^1.9.0",
    "@changesets/cli": "^2.27.0",
    "lefthook": "^1.7.0",
    "typescript": "^5.6.0"
  }
}
```

- [ ] **Step 2:** Create `pnpm-workspace.yaml`:

```yaml
packages:
  - "packages/*"
  - "tools/*"
```

- [ ] **Step 3:** Create `tsconfig.base.json`:

```json
{
  "$schema": "https://json.schemastore.org/tsconfig",
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ES2022"],
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "exactOptionalPropertyTypes": true,
    "noFallthroughCasesInSwitch": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "forceConsistentCasingInFileNames": true,
    "skipLibCheck": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "esModuleInterop": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "verbatimModuleSyntax": true
  }
}
```

- [ ] **Step 4:** Create `biome.json`:

```json
{
  "$schema": "https://biomejs.dev/schemas/1.9.0/schema.json",
  "organizeImports": { "enabled": true },
  "linter": {
    "enabled": true,
    "rules": {
      "recommended": true,
      "suspicious": { "noExplicitAny": "error" },
      "style": { "useImportType": "error" },
      "correctness": { "noUnusedVariables": "error" }
    }
  },
  "formatter": {
    "enabled": true,
    "indentStyle": "space",
    "indentWidth": 2,
    "lineWidth": 110
  },
  "files": { "ignore": ["node_modules", "dist", "coverage", "**/*.txt"] }
}
```

- [ ] **Step 5:** Create `lefthook.yml`:

```yaml
pre-commit:
  parallel: true
  commands:
    biome:
      glob: "*.{ts,tsx,js,jsx,json}"
      run: pnpm biome check --write {staged_files}
      stage_fixed: true
commit-msg:
  commands:
    dco:
      run: |
        grep -q "^Signed-off-by: " "$1" || { echo "Commit missing Signed-off-by trailer (use git commit -s)"; exit 1; }
```

- [ ] **Step 6:** Create `.editorconfig`:

```
root = true
[*]
charset = utf-8
end_of_line = lf
indent_style = space
indent_size = 2
insert_final_newline = true
trim_trailing_whitespace = true
```

- [ ] **Step 7:** Install + init:

```bash
cd F:/BACKUP/Programacion/mtg-forge-ts
pnpm install
pnpm lefthook install
```

- [ ] **Step 8:** Commit:

```bash
git add package.json pnpm-workspace.yaml tsconfig.base.json biome.json lefthook.yml .editorconfig pnpm-lock.yaml
git commit -s -m "chore: bootstrap pnpm workspace + biome + lefthook"
```

---

### Task 2: `@mtg-forge-ts/core` package skeleton

**Files:**
- Create: `packages/core/package.json`, `packages/core/tsconfig.json`, `packages/core/tsup.config.ts`, `packages/core/src/index.ts`, `packages/core/vitest.config.ts`, `packages/core/README.md`, `packages/core/CHANGELOG.md`, `packages/core/LICENSE`

- [ ] **Step 1:** `packages/core/package.json`:

```json
{
  "name": "@mtg-forge-ts/core",
  "version": "0.0.0",
  "description": "Core types, views, RNG, events, and decisions for mtg-forge-ts.",
  "license": "GPL-3.0-or-later",
  "type": "module",
  "main": "./dist/index.cjs",
  "module": "./dist/index.mjs",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.mjs",
      "require": "./dist/index.cjs"
    }
  },
  "files": ["dist", "README.md", "LICENSE", "CHANGELOG.md"],
  "scripts": {
    "build": "tsup",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "test:unit": "vitest run",
    "test:watch": "vitest"
  },
  "devDependencies": {
    "fast-check": "^3.22.0",
    "tsup": "^8.3.0",
    "typescript": "^5.6.0",
    "vitest": "^2.1.0"
  }
}
```

- [ ] **Step 2:** `packages/core/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "rootDir": "src",
    "outDir": "dist"
  },
  "include": ["src/**/*"]
}
```

- [ ] **Step 3:** `packages/core/tsup.config.ts`:

```ts
import { defineConfig } from "tsup";
export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm", "cjs"],
  dts: true,
  clean: true,
  sourcemap: true,
  target: "node20",
  outExtension({ format }) {
    return { js: format === "esm" ? ".mjs" : ".cjs" };
  },
});
```

**Note for all future packages:** the `outExtension` override is required whenever the `package.json` uses explicit `.mjs` / `.cjs` extensions in its `exports` field. Without it, tsup with `"type": "module"` emits plain `.js` for ESM, and the `exports.import` path points to a non-existent `.mjs` file — breaking module resolution for dual ESM+CJS consumers. Applies to core, game, ai, cards, formats, limited, and engine packages identically.

- [ ] **Step 4:** `packages/core/vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    environment: "node",
    globals: false,
    include: ["src/**/*.test.ts", "test/**/*.test.ts"],
    coverage: { provider: "v8", reporter: ["text", "lcov"] },
  },
});
```

- [ ] **Step 5:** `packages/core/src/index.ts`:

```ts
// SPDX-License-Identifier: GPL-3.0-or-later
// Placeholder — filled in by subsequent tasks.
export const CORE_VERSION = "0.0.0";
```

- [ ] **Step 6:** `packages/core/src/index.test.ts`:

```ts
// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from "vitest";
import { CORE_VERSION } from "./index.js";

describe("core smoke", () => {
  it("exposes CORE_VERSION", () => {
    expect(CORE_VERSION).toBe("0.0.0");
  });
});
```

- [ ] **Step 7:** `packages/core/README.md`: one-line stub describing the package purpose. `packages/core/CHANGELOG.md`: empty heading `# @mtg-forge-ts/core`. Copy root GPL text into `packages/core/LICENSE` once root LICENSE exists (Task 5).

- [ ] **Step 8:** Install deps + verify build/test works:

```bash
pnpm -F @mtg-forge-ts/core install
pnpm -F @mtg-forge-ts/core typecheck
pnpm -F @mtg-forge-ts/core test
pnpm -F @mtg-forge-ts/core build
```

Expected: typecheck clean, 1 test passes, dist/ populated.

- [ ] **Step 9:** Commit: `git add packages/core pnpm-lock.yaml && git commit -s -m "feat(core): scaffold @mtg-forge-ts/core package"`

---

### Task 3: `@mtg-forge-ts/game` package skeleton

**Files:**
- Create: `packages/game/package.json`, `packages/game/tsconfig.json`, `packages/game/tsup.config.ts`, `packages/game/src/index.ts`, `packages/game/src/index.test.ts`, `packages/game/vitest.config.ts`, `packages/game/README.md`, `packages/game/CHANGELOG.md`, `packages/game/LICENSE`

- [ ] **Step 1:** Mirror Task 2 substituting `game` for `core`. `package.json` adds `"dependencies": { "@mtg-forge-ts/core": "workspace:*" }`.

- [ ] **Step 2:** `packages/game/src/index.ts`:

```ts
// SPDX-License-Identifier: GPL-3.0-or-later
import { CORE_VERSION } from "@mtg-forge-ts/core";
export const GAME_VERSION = "0.0.0";
export const LINKED_CORE_VERSION = CORE_VERSION;
```

- [ ] **Step 3:** `packages/game/src/index.test.ts`:

```ts
// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from "vitest";
import { GAME_VERSION, LINKED_CORE_VERSION } from "./index.js";

describe("game smoke", () => {
  it("links to core", () => {
    expect(GAME_VERSION).toBe("0.0.0");
    expect(LINKED_CORE_VERSION).toBe("0.0.0");
  });
});
```

- [ ] **Step 4:** Verify: `pnpm -F @mtg-forge-ts/game typecheck && pnpm -F @mtg-forge-ts/game test`

- [ ] **Step 5:** Commit: `git commit -s -m "feat(game): scaffold @mtg-forge-ts/game package"`

---

### Task 4: CI skeleton (GitHub Actions)

**Files:** `.github/workflows/ci.yaml`, `.github/workflows/dco-check.yaml`

- [ ] **Step 1:** `.github/workflows/ci.yaml`:

```yaml
name: ci
on: [push, pull_request]
jobs:
  build-test:
    runs-on: ubuntu-latest
    strategy:
      matrix:
        node: [20, 22]
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with: { version: 9 }
      - uses: actions/setup-node@v4
        with: { node-version: ${{ matrix.node }}, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - run: pnpm lint
      - run: pnpm typecheck
      - run: pnpm test
      - run: pnpm build
```

- [ ] **Step 2:** `.github/workflows/dco-check.yaml`:

```yaml
name: dco
on: [pull_request]
jobs:
  verify:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with: { fetch-depth: 0 }
      - name: Check DCO sign-off on all commits
        run: |
          base="${{ github.event.pull_request.base.sha }}"
          head="${{ github.event.pull_request.head.sha }}"
          missing=0
          for sha in $(git rev-list "$base..$head"); do
            if ! git log -1 --format=%B "$sha" | grep -q "^Signed-off-by: "; then
              echo "Commit $sha missing Signed-off-by trailer"
              missing=1
            fi
          done
          exit $missing
```

- [ ] **Step 3:** Commit: `git add .github && git commit -s -m "ci: add lint+typecheck+test+build workflow and DCO check"`

---

### Task 5: Root `LICENSE` and `NOTICE` files

- [ ] **Step 1:** Download GPL-3.0 text to `LICENSE`:

```bash
curl -sSL https://www.gnu.org/licenses/gpl-3.0.txt -o LICENSE
```

Verify first line reads `                    GNU GENERAL PUBLIC LICENSE`.

- [ ] **Step 2:** Create `NOTICE`:

```
mtg-forge-ts is a derivative work of Card-Forge/forge (https://github.com/Card-Forge/forge),
licensed under GPL-3.0-or-later.

Upstream sync: (pending first sync — see packages/cards/data/SYNCED.json when SP4 begins).

Magic: The Gathering is a trademark of Wizards of the Coast LLC.
This project is unofficial and not affiliated with or endorsed by Wizards of the Coast.
```

- [ ] **Step 3:** Copy LICENSE into each package:

```bash
cp LICENSE packages/core/LICENSE
cp LICENSE packages/game/LICENSE
```

- [ ] **Step 4:** Commit: `git add LICENSE NOTICE packages/*/LICENSE && git commit -s -m "docs: add GPL-3.0 LICENSE and NOTICE"`

---

### Task 6: `CONTRIBUTING.md`, `SECURITY.md`, `.gitmessage`

- [ ] **Step 1:** `CONTRIBUTING.md`:

```markdown
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
```

- [ ] **Step 2:** `.gitmessage`:

```
# <type>(<scope>): <subject>
#
# <body: explain what and why>
#
# Signed-off-by: Your Name <you@example.com>
```

- [ ] **Step 3:** `SECURITY.md` — minimal disclosure instructions.

- [ ] **Step 4:** Commit: `git add CONTRIBUTING.md SECURITY.md .gitmessage && git commit -s -m "docs: add CONTRIBUTING, SECURITY, and commit template"`

---

### Task 7: Verify full-workspace baseline

- [ ] **Step 1:** Run from repo root:

```bash
pnpm install
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

All must succeed. If any fails, fix before proceeding.

- [ ] **Step 2:** No commit (verification only).

---

## Milestone B — Core: branded IDs + primitive enums

### Task 8: Branded identity types

**Files:** `packages/core/src/ids.ts`, `packages/core/src/ids.test.ts`

- [ ] **Step 1 (failing test):** `packages/core/src/ids.test.ts`:

```ts
// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from "vitest";
import { type EntityId, type DecisionId, type PlayerSeat, mkEntityId, mkDecisionId, mkPlayerSeat } from "./ids.js";

describe("branded IDs", () => {
  it("constructs branded EntityId that is type-incompatible with number", () => {
    const id: EntityId = mkEntityId(42);
    expect(id as unknown as number).toBe(42);
  });
  it("branded DecisionId and EntityId are not interchangeable in types", () => {
    const eid: EntityId = mkEntityId(1);
    const did: DecisionId = mkDecisionId(1);
    expect(eid as unknown as number).toBe(did as unknown as number);
    // compile-time check: the following line would fail typecheck if uncommented.
    // const d2: DecisionId = eid;
  });
  it("PlayerSeat rejects negative values and accepts non-negative integers", () => {
    const seat: PlayerSeat = mkPlayerSeat(0);
    expect(seat as unknown as number).toBe(0);
    expect(() => mkPlayerSeat(-1)).toThrow();
  });
});
```

The `const seat: PlayerSeat = ...` annotation consumes the imported `type PlayerSeat`, otherwise `noUnusedLocals: true` in `tsconfig.base.json` fails the typecheck. Same pattern applies to future branded-type tests.

- [ ] **Step 2 (run red):** `pnpm -F @mtg-forge-ts/core test` → expect module-not-found.

- [ ] **Step 3 (implementation):** `packages/core/src/ids.ts`:

```ts
// SPDX-License-Identifier: GPL-3.0-or-later
declare const __brand: unique symbol;
type Brand<T, B> = T & { readonly [__brand]: B };

export type EntityId = Brand<number, "EntityId">;
export type DecisionId = Brand<number, "DecisionId">;
export type PlayerSeat = Brand<number, "PlayerSeat">;

export const mkEntityId = (n: number): EntityId => n as EntityId;
export const mkDecisionId = (n: number): DecisionId => n as DecisionId;
export const mkPlayerSeat = (n: number): PlayerSeat => {
  if (!Number.isInteger(n) || n < 0) throw new RangeError(`PlayerSeat must be a non-negative integer, got ${n}`);
  return n as PlayerSeat;
};
```

Export from `packages/core/src/index.ts`: add `export * from "./ids.js";`.

- [ ] **Step 4 (run green):** `pnpm -F @mtg-forge-ts/core test` → 3 passes.

- [ ] **Step 5 (commit):** `git commit -s -m "feat(core): add branded EntityId, DecisionId, PlayerSeat types"`

---

### Task 9: `Color` + `ColorSet` bitset

**Files:** `packages/core/src/color.ts`, `packages/core/src/color.test.ts`

- [ ] **Step 1 (failing test):**

```ts
// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from "vitest";
import { Color, ColorSet } from "./color.js";

describe("ColorSet", () => {
  it("empty set has no colors", () => {
    expect(ColorSet.empty().has(Color.White)).toBe(false);
    expect(ColorSet.empty().size).toBe(0);
  });
  it("single-color set", () => {
    const s = ColorSet.of(Color.Red);
    expect(s.has(Color.Red)).toBe(true);
    expect(s.has(Color.Blue)).toBe(false);
    expect(s.size).toBe(1);
  });
  it("union + intersect + subset", () => {
    const wu = ColorSet.of(Color.White, Color.Blue);
    const ub = ColorSet.of(Color.Blue, Color.Black);
    expect(wu.union(ub).size).toBe(3);
    expect(wu.intersect(ub).equals(ColorSet.of(Color.Blue))).toBe(true);
    expect(ColorSet.of(Color.White).isSubsetOf(wu)).toBe(true);
  });
  it("toJSON round-trip", () => {
    const s = ColorSet.of(Color.Red, Color.Green, Color.Blue);
    expect(ColorSet.fromJSON(s.toJSON()).equals(s)).toBe(true);
  });
});
```

- [ ] **Step 2 (red):** run tests, expect failures.

- [ ] **Step 3 (implementation):**

```ts
// SPDX-License-Identifier: GPL-3.0-or-later
export enum Color { White = 1, Blue = 2, Black = 4, Red = 8, Green = 16, Colorless = 32 }

export class ColorSet {
  private constructor(private readonly bits: number) {}
  static empty(): ColorSet { return new ColorSet(0); }
  static of(...colors: Color[]): ColorSet { return new ColorSet(colors.reduce((b, c) => b | c, 0)); }
  static fromJSON(bits: number): ColorSet { return new ColorSet(bits); }
  has(c: Color): boolean { return (this.bits & c) !== 0; }
  get size(): number { let b = this.bits, n = 0; while (b) { n += b & 1; b >>>= 1; } return n; }
  union(o: ColorSet): ColorSet { return new ColorSet(this.bits | o.bits); }
  intersect(o: ColorSet): ColorSet { return new ColorSet(this.bits & o.bits); }
  isSubsetOf(o: ColorSet): boolean { return (this.bits & o.bits) === this.bits; }
  equals(o: ColorSet): boolean { return this.bits === o.bits; }
  toJSON(): number { return this.bits; }
}
```

Export from `index.ts`.

- [ ] **Step 4 (green):** all pass.

- [ ] **Step 5 (commit):** `git commit -s -m "feat(core): add Color enum and ColorSet bitset"`

---

### Task 10: `ZoneType` enum + zone predicates

**Files:** `packages/core/src/zone.ts`, `packages/core/src/zone.test.ts`

- [ ] **Step 1 (test):** Tests cover: all 18 zone types enumerated (Library, Hand, Battlefield, Graveyard, Exile, Stack, Command, Ante, Sideboard, PlanarDeck, SchemeDeck, ConspiracyDeck, AttractionDeck, ContraptionDeck, StickerDeck, Banished, Phased, None, OutsideGame); `isPerPlayerZone` returns true for Library/Hand/Graveyard/Sideboard/planar/scheme/conspiracy/attraction/contraption/sticker, false for Stack/Exile/Command/Ante; `isBattlefieldZone(ZoneType.Battlefield)` true; `isHiddenZone(Library) === true`.

- [ ] **Step 2 (red):** run.

- [ ] **Step 3 (impl):**

```ts
// SPDX-License-Identifier: GPL-3.0-or-later
export enum ZoneType {
  Library = "library", Hand = "hand", Battlefield = "battlefield", Graveyard = "graveyard",
  Exile = "exile", Stack = "stack", Command = "command", Ante = "ante",
  Sideboard = "sideboard", PlanarDeck = "planarDeck", SchemeDeck = "schemeDeck",
  ConspiracyDeck = "conspiracyDeck", AttractionDeck = "attractionDeck",
  ContraptionDeck = "contraptionDeck", StickerDeck = "stickerDeck",
  Banished = "banished", Phased = "phased", None = "none", OutsideGame = "outsideGame",
}

const PER_PLAYER: ReadonlySet<ZoneType> = new Set([
  ZoneType.Library, ZoneType.Hand, ZoneType.Graveyard, ZoneType.Sideboard,
  ZoneType.PlanarDeck, ZoneType.SchemeDeck, ZoneType.ConspiracyDeck,
  ZoneType.AttractionDeck, ZoneType.ContraptionDeck, ZoneType.StickerDeck,
  ZoneType.Battlefield, // per-player per engine model
]);
const HIDDEN: ReadonlySet<ZoneType> = new Set([ZoneType.Library, ZoneType.Hand, ZoneType.Sideboard]);

export const isPerPlayerZone = (z: ZoneType): boolean => PER_PLAYER.has(z);
export const isHiddenZone = (z: ZoneType): boolean => HIDDEN.has(z);
export const isBattlefieldZone = (z: ZoneType): boolean => z === ZoneType.Battlefield;
```

- [ ] **Step 4 (green):** all pass. Export from index.

- [ ] **Step 5 (commit):** `git commit -s -m "feat(core): add ZoneType enum and zone predicates"`

---

### Task 11: `PhaseStep` enum + canonical phase sequence

**Files:** `packages/core/src/phase.ts`, `packages/core/src/phase.test.ts`

- [ ] **Step 1 (test):** Tests: enum has the 13 canonical values (Untap, Upkeep, Draw, PreCombatMain, BeginCombat, DeclareAttackers, DeclareBlockers, FirstStrikeDamage, CombatDamage, EndOfCombat, PostCombatMain, EndStep, Cleanup); `canonicalPhaseSequence` returns them in order; `isCombatStep(DeclareAttackers) === true` for 6 combat steps.

- [ ] **Step 2-4:** Implement enum + `canonicalPhaseSequence: readonly PhaseStep[]` + `isCombatStep(step)`. Export.

- [ ] **Step 5 (commit):** `git commit -s -m "feat(core): add PhaseStep enum and canonical sequence"`

---

### Task 12: `CounterType` enum

**Files:** `packages/core/src/counter-type.ts`, `packages/core/src/counter-type.test.ts`

- [ ] **Step 1 (test):** Asserts 60+ counter types are defined and unique by string value. List names verbatim: PlusOnePlusOne, MinusOneMinusOne, Loyalty, Defense, Stun, Shield, Charge, Age, Level, Time, Lore, Verse, Divinity, Quest, Poison, Energy, Experience, Ticket, Rad, Brick, Crystal, Delay, Despair, Depletion, Dread, Echo, Egg, Everything, Eyeball, Fade, Feather, Filibuster, Flame, Flood, Fungus, Fuse, Gem, Gold, Growth, Hatchling, Hit, Hoofprint, Hour, Hourglass, Hunger, Husk, Incubation, Infection, Influence, Intervention, Isolation, Javelin, Judgment, Ki, Knowledge, Landmark, Lotus, Luck, Manabond, Manifestation, Mannequin, Matrix, Mine, Mining, Mire, Music, Muster, Net, Omen, Ore, Page, Pain, Paralyzation, Phylactery, Pin, Plague, Plot, Point, Polyp, Pressure, Prey, Pupa, Rejection, Reprieve, Rev, Revival, Rope, Rust, Scream, Scroll, Shell, Silver, Sleep, Sleight, Slime, Slumber, Soot, Spite, Spore, Sprout, Storage, Strife, Tide, Tower, Training, Trap, Treasure, Unity, Velocity, Volatile, Winch, Wind, Wish.

- [ ] **Step 2-4:** Define as `enum CounterType { PlusOnePlusOne = "+1/+1", MinusOneMinusOne = "-1/-1", ... }` (string values). **Note:** the list above is illustrative — port exact names and string values from Forge's `forge-game/src/main/java/forge/game/card/CounterEnumType.java` during implementation. The plan's enumeration is for sizing, not canonical spelling.

- [ ] **Step 5 (commit):** `git commit -s -m "feat(core): add CounterType enum with full Forge counter taxonomy"`

---

## Milestone C — Core: Mana system

### Task 13: `ManaSymbol` + `ManaCost` + `ManaValue`

**Files:** `packages/core/src/mana/symbol.ts`, `packages/core/src/mana/cost.ts`, `packages/core/src/mana/index.ts`, corresponding `.test.ts` files.

- [ ] **Step 1 (test — symbol):** Parsing a cost string `"2WU"` yields symbols [{generic:2}, {color:W}, {color:U}]; `"X1B"` yields [{variable:X},{generic:1},{color:B}]; `"W/U"` yields hybrid; `"2/W"` yields monocolor-hybrid; `"W/P"` yields phyrexian; `"S"` yields snow; `"C"` yields colorless. Invalid input throws `ManaParseError`.

- [ ] **Step 2 (red).**

- [ ] **Step 3 (impl):** `ManaSymbol` is a discriminated union:

```ts
export type ManaSymbol =
  | { kind: "generic"; amount: number }
  | { kind: "variable"; letter: "X" | "Y" | "Z" }
  | { kind: "colored"; color: Color }
  | { kind: "colorless" }
  | { kind: "snow" }
  | { kind: "hybrid"; a: Color; b: Color }
  | { kind: "monoHybrid"; generic: 2; color: Color }
  | { kind: "phyrexian"; color: Color };

export class ManaCost {
  constructor(readonly symbols: readonly ManaSymbol[]) {}
  static parse(text: string): ManaCost { /* tokenize & build */ }
  cmc(xValue = 0): number { /* sum including variable → xValue */ }
  colors(): ColorSet { /* union of colored+hybrid+phyrexian colors */ }
  toJSON(): { symbols: ManaSymbol[] } { return { symbols: [...this.symbols] }; }
  static fromJSON(s: { symbols: ManaSymbol[] }): ManaCost { return new ManaCost(s.symbols); }
}
```

`ManaValue` is a type alias `number` for CMC, with helpers `manaValue(cost: ManaCost, x?: number): number`.

`ManaParseError` extends `Error` (proper typed error — we'll formalize in Task 28).

- [ ] **Step 4 (green):** all tests pass.

- [ ] **Step 5 (commit):** `git commit -s -m "feat(core): add ManaSymbol, ManaCost, ManaValue"`

---

### Task 14: `ManaShard` (mana pool piece)

**Files:** `packages/core/src/mana/shard.ts`, `.test.ts`

- [ ] **Step 1 (test):** `ManaShard.colored(Color.Red, {sourceId: 42})` has `color=Red`, `isSnow=false`, `restriction="none"`; `ManaShard.snow(Color.Blue)` has `isSnow=true`; serialization round-trips.

- [ ] **Step 2-4:**

```ts
export type ManaRestriction = "none" | "creatureSpells" | "onlyThisTurn" | "mustSpendOrLoseLife" | "artifactSpells";

export class ManaShard {
  constructor(
    readonly color: Color | null,   // null = colorless generic
    readonly sourceId: EntityId | null,
    readonly isSnow: boolean,
    readonly restriction: ManaRestriction,
  ) {}
  static colored(c: Color, opts: { sourceId?: EntityId; restriction?: ManaRestriction } = {}): ManaShard {
    return new ManaShard(c, opts.sourceId ?? null, false, opts.restriction ?? "none");
  }
  static colorless(opts: { sourceId?: EntityId } = {}): ManaShard {
    return new ManaShard(null, opts.sourceId ?? null, false, "none");
  }
  static snow(c: Color | null, opts: { sourceId?: EntityId } = {}): ManaShard {
    return new ManaShard(c, opts.sourceId ?? null, true, "none");
  }
  toJSON() { return { color: this.color, sourceId: this.sourceId, isSnow: this.isSnow, restriction: this.restriction }; }
  static fromJSON(s: ReturnType<ManaShard["toJSON"]>): ManaShard {
    return new ManaShard(s.color, s.sourceId as EntityId | null, s.isSnow, s.restriction);
  }
}
```

- [ ] **Step 5 (commit):** `git commit -s -m "feat(core): add ManaShard for mana pool tracking"`

---

## Milestone D — Core: Cost system

### Task 15: `CostPart` data hierarchy — base class + discriminated union

**Files:** `packages/core/src/cost/cost-part.ts`, `packages/core/src/cost/cost.ts`, `.test.ts`

SP1 scope: data shapes + serialization only. Runtime methods (`canPay`, `pay`, `undo`) are defined as abstract and throw in SP1; SP3 fills implementations.

- [ ] **Step 1 (test):** Cost round-trips via JSON; `Cost.of(...parts).parts.length === N`; polymorphic serialization uses `kind` field.

- [ ] **Step 2-4 (impl):**

```ts
// SPDX-License-Identifier: GPL-3.0-or-later
export abstract class CostPart {
  abstract readonly kind: string;
  abstract toJSON(): { kind: string; [k: string]: unknown };
}

export class Cost {
  constructor(readonly parts: readonly CostPart[]) {}
  static of(...parts: CostPart[]): Cost { return new Cost(parts); }
  toJSON(): { parts: Array<{ kind: string; [k: string]: unknown }> } {
    return { parts: this.parts.map(p => p.toJSON()) };
  }
  static fromJSON(s: { parts: Array<{ kind: string; [k: string]: unknown }> }): Cost {
    return new Cost(s.parts.map(part => CostPartRegistry.hydrate(part)));
  }
}

export class CostPartRegistry {
  private static ctors = new Map<string, (data: { kind: string; [k: string]: unknown }) => CostPart>();
  static register(kind: string, ctor: (data: { kind: string; [k: string]: unknown }) => CostPart): void {
    this.ctors.set(kind, ctor);
  }
  static hydrate(data: { kind: string; [k: string]: unknown }): CostPart {
    const ctor = this.ctors.get(data.kind);
    if (!ctor) throw new Error(`Unknown CostPart kind: ${data.kind}`);
    return ctor(data);
  }
}
```

- [ ] **Step 5 (commit):** `git commit -s -m "feat(core): add CostPart hierarchy and CostPartRegistry"`

---

### Task 16: Concrete CostPart classes (batch, 30 classes)

**Files:** `packages/core/src/cost/parts/*.ts` (one per kind), `packages/core/src/cost/parts.test.ts`

Classes to add (each is ~15 lines). **Port exact taxonomy from `forge-game/src/main/java/forge/game/cost/*.java`.** The list below is representative; adjust to match Forge's actual Cost* classes:
`CostMana`, `CostTap`, `CostUntap`, `CostSacrifice`, `CostDiscard`, `CostExile`, `CostPayLife`, `CostPayEnergy`, `CostPayExperience`, `CostPayTicket`, `CostPayRad`, `CostRemoveCounter`, `CostPutCounter`, `CostReveal`, `CostMill`, `CostReturn`, `CostUnattach`, `CostGainControl`, `CostFlipCoin`, `CostRollDie`, `CostSkipTurn`, `CostExileFromHand`, `CostExileFromGraveyard`, `CostPutIntoLibrary`, `CostReturnToHand`, `CostTapXCreatures`, `CostUntapXCreatures`, `CostExert`, `CostCollectEvidence`, `CostDescend`.

Pattern per class:

```ts
// SPDX-License-Identifier: GPL-3.0-or-later
import { CostPart, CostPartRegistry } from "../cost.js";
import { ManaCost } from "../../mana/cost.js";

export class CostMana extends CostPart {
  readonly kind = "mana";
  constructor(readonly cost: ManaCost) { super(); }
  toJSON() { return { kind: this.kind, cost: this.cost.toJSON() }; }
}
CostPartRegistry.register("mana", (d) => new CostMana(ManaCost.fromJSON(d.cost as Parameters<typeof ManaCost.fromJSON>[0])));
```

Integer-typed cost parts (`CostPayLife`, `CostMill`, etc.) carry an `amount: number` (or a string expression to be interpreted in SP3's SVar evaluator — for SP1 just store the string verbatim).

- [ ] **Step 1 (test):** For each of the 30 kinds, instantiate with sample data, call `toJSON()`, hydrate via `Cost.fromJSON`, assert deep equality.

- [ ] **Step 2-4:** Implement all 30. Export from `packages/core/src/cost/index.ts`.

- [ ] **Step 5 (commit):** `git commit -s -m "feat(core): add 30 CostPart concrete classes"`

---

## Milestone E — Core: Card + Deck data types

### Task 17: Card types (Supertype, CardType, Subtype, Rarity)

**Files:** `packages/core/src/card/types.ts`, `.test.ts`

- [ ] **Step 1 (test):** Enum values are string literals; `TypeLine.parse("Legendary Enchantment Creature — Human Wizard")` parses into supertypes=[Legendary], types=[Enchantment, Creature], subtypes=[Human, Wizard].

- [ ] **Step 2-4 (impl):**

```ts
export enum Supertype { Basic = "Basic", Legendary = "Legendary", Snow = "Snow", World = "World", Ongoing = "Ongoing", Host = "Host" }
// Port exact list from Forge's Supertype enum; above is known-safe subset.
export enum CardType { Artifact = "Artifact", Battle = "Battle", Conspiracy = "Conspiracy", Creature = "Creature", Dungeon = "Dungeon", Emblem = "Emblem", Enchantment = "Enchantment", Hero = "Hero", Instant = "Instant", Land = "Land", Phenomenon = "Phenomenon", Plane = "Plane", Planeswalker = "Planeswalker", Scheme = "Scheme", Sorcery = "Sorcery", Tribal = "Tribal", Vanguard = "Vanguard" }
export enum Rarity { Common = "common", Uncommon = "uncommon", Rare = "rare", Mythic = "mythic", Special = "special", Bonus = "bonus", Token = "token" }

export class TypeLine {
  constructor(readonly supertypes: readonly Supertype[], readonly types: readonly CardType[], readonly subtypes: readonly string[]) {}
  static parse(text: string): TypeLine { /* split on em-dash, classify tokens */ }
  toJSON() { return { supertypes: [...this.supertypes], types: [...this.types], subtypes: [...this.subtypes] }; }
  static fromJSON(s: ReturnType<TypeLine["toJSON"]>): TypeLine {
    return new TypeLine(s.supertypes, s.types, s.subtypes);
  }
}
```

Subtype is a free-form string (MTG has hundreds of creature types, artifact types, etc. — enumeration moves to runtime data).

- [ ] **Step 5 (commit):** `git commit -s -m "feat(core): add Supertype, CardType, Rarity, and TypeLine"`

---

### Task 18: `PaperCard` + `CardDefinition` data placeholders

**Files:** `packages/core/src/card/paper-card.ts`, `packages/core/src/card/card-definition.ts`, `.test.ts`

SP1 defines these as plain data shells. SP3/SP4 populate them from the DSL parser. CardDefinition fields beyond name/basic shape are optional in SP1.

- [ ] **Step 1 (test):** Construct a `PaperCard` with `{name: "Lightning Bolt", set: "LEA", collectorNumber: "161", language: "en"}`; serialize + round-trip; `paperCard.key` returns deterministic string `"LEA:161:en"`.

- [ ] **Step 2-4:**

```ts
// card-definition.ts
export interface CardDefinition {
  name: string;
  oracle: string;
  // Populated by SP3 parser:
  manaCost: unknown | null;       // ManaCostAst — typed in later DSL AST task
  types: TypeLine;
  pt?: { power: string; toughness: string };
  loyalty?: string;
  defense?: string;
  colors?: ColorSet;
  abilities: unknown[];
  triggers: unknown[];
  replacements: unknown[];
  statics: unknown[];
  keywords: unknown[];
  svars: Map<string, unknown>;
  faces?: CardDefinition[];
}

// paper-card.ts
export interface PaperCard {
  name: string;
  set: string;
  collectorNumber: string;
  language: string;
  foil: boolean;
  borderless: boolean;
  artSeries: boolean;
  scryfallId?: string;
  definition?: CardDefinition;     // resolved at load time via CardDb
}

export const paperCardKey = (p: PaperCard): string => `${p.set}:${p.collectorNumber}:${p.language}`;
```

- [ ] **Step 5 (commit):** `git commit -s -m "feat(core): add PaperCard and CardDefinition data shapes"`

---

### Task 19: `Deck` + `DeckSection` + `DeckFormat`

**Files:** `packages/core/src/deck/deck.ts`, `.test.ts`

- [ ] **Step 1 (test):** Empty deck, add cards to main/sideboard/command, count totals, serialize, round-trip. Deck-level singleton detection helper `hasSingletonViolation(deck)` returns names with count > 1 excluding basic lands.

- [ ] **Step 2-4:**

```ts
export interface DeckEntry { card: PaperCard; count: number; }
export type CommanderSlot =
  | { kind: "none" }
  | { kind: "single"; commander: PaperCard }
  | { kind: "partners"; a: PaperCard; b: PaperCard }
  | { kind: "background"; commander: PaperCard; background: PaperCard }
  | { kind: "oathbreaker"; planeswalker: PaperCard; signatureSpell: PaperCard };

export interface Deck {
  name: string;
  main: DeckEntry[];
  sideboard: DeckEntry[];
  commanderSlot: CommanderSlot;
  planar?: PaperCard[];
  scheme?: PaperCard[];
  conspiracy?: PaperCard[];
  attractions?: PaperCard[];
  contraptions?: PaperCard[];
}

export const deckSize = (d: Deck): number => d.main.reduce((n, e) => n + e.count, 0);
export const sideboardSize = (d: Deck): number => d.sideboard.reduce((n, e) => n + e.count, 0);
```

- [ ] **Step 5 (commit):** `git commit -s -m "feat(core): add Deck type with all commander-family zones"`

---

## Milestone F — Core: Rng

### Task 20: `Rng` interface + `SeededRng` (xoshiro256**)

**Files:** `packages/core/src/rng/rng.ts`, `packages/core/src/rng/seeded-rng.ts`, `.test.ts`, property test in `packages/core/src/rng/rng.property.test.ts`.

- [ ] **Step 1 (test — unit):** Same seed → same output sequence of `nextInt`, `nextFloat`, `nextLong`, `shuffle`. Different seeds → different sequences. `getState()`/`setState()` round-trips (continuing from restored state yields the same subsequent output as the original).

- [ ] **Step 2 (test — property):** `fast-check` property: for arbitrary seeds + arbitrary small arrays, `shuffle` is a permutation (same multiset).

- [ ] **Step 3 (red).**

- [ ] **Step 4 (impl):**

```ts
// rng.ts
export interface RngState { readonly s0: bigint; readonly s1: bigint; readonly s2: bigint; readonly s3: bigint; }

export interface Rng {
  nextInt(minInclusive: number, maxExclusive: number): number;
  nextFloat(): number;              // [0, 1)
  nextLong(): bigint;
  choose<T>(arr: readonly T[]): T;
  shuffle<T>(arr: readonly T[]): T[];
  getState(): RngState;
  setState(s: RngState): void;
}
```

```ts
// seeded-rng.ts — xoshiro256** implementation
const MASK64 = (1n << 64n) - 1n;
const rotl = (x: bigint, k: bigint): bigint => ((x << k) | (x >> (64n - k))) & MASK64;

export class SeededRng implements Rng {
  private s: [bigint, bigint, bigint, bigint];
  constructor(seed: bigint) {
    // SplitMix64 to seed all 4 state words from one seed.
    let z = seed & MASK64;
    const next = (): bigint => {
      z = (z + 0x9e3779b97f4a7c15n) & MASK64;
      let y = (z ^ (z >> 30n)) * 0xbf58476d1ce4e5b9n & MASK64;
      y = (y ^ (y >> 27n)) * 0x94d049bb133111ebn & MASK64;
      return (y ^ (y >> 31n)) & MASK64;
    };
    this.s = [next(), next(), next(), next()];
  }
  nextLong(): bigint {
    const [s0, s1, s2, s3] = this.s;
    const result = (rotl((s1 * 5n) & MASK64, 7n) * 9n) & MASK64;
    const t = (s1 << 17n) & MASK64;
    this.s[2] = s2 ^ s0;
    this.s[3] = s3 ^ s1;
    this.s[1] = s1 ^ this.s[2];
    this.s[0] = s0 ^ this.s[3];
    this.s[2] = this.s[2] ^ t;
    this.s[3] = rotl(this.s[3], 45n);
    return result;
  }
  nextFloat(): number {
    const bits = Number(this.nextLong() >> 11n);   // top 53 bits
    return bits / 2 ** 53;
  }
  nextInt(min: number, max: number): number {
    return min + Math.floor(this.nextFloat() * (max - min));
  }
  choose<T>(arr: readonly T[]): T {
    if (arr.length === 0) throw new RangeError("choose: empty array");
    return arr[this.nextInt(0, arr.length)] as T;
  }
  shuffle<T>(arr: readonly T[]): T[] {
    const out = [...arr];
    for (let i = out.length - 1; i > 0; i--) {
      const j = this.nextInt(0, i + 1);
      [out[i], out[j]] = [out[j] as T, out[i] as T];
    }
    return out;
  }
  getState(): RngState { return { s0: this.s[0], s1: this.s[1], s2: this.s[2], s3: this.s[3] }; }
  setState(st: RngState): void { this.s = [st.s0, st.s1, st.s2, st.s3]; }
}
```

- [ ] **Step 5 (green).**

- [ ] **Step 6 (commit):** `git commit -s -m "feat(core): add Rng interface and xoshiro256** SeededRng"`

---

## Milestone G — Core: Errors + Events + Decisions

### Task 20b: `GameLog` types (core)

**Files:** `packages/core/src/log/game-log.ts`, tests.

SP1 §2.1 lists `GameLog`, `GameLogEntry`, `GameLogVerbosity` as core data types.

- [ ] **Step 1-4:**

```ts
// SPDX-License-Identifier: GPL-3.0-or-later
export enum GameLogVerbosity { Silent = 0, Errors = 1, Public = 2, Private = 3, Debug = 4 }

export interface GameLogEntry {
  at: { turn: number; phase: string };   // string to avoid core→phase-enum coupling
  verbosity: GameLogVerbosity;
  message: string;
  subject?: EntityId;
  actor?: PlayerSeat;
}

export class GameLog {
  private entries: GameLogEntry[] = [];
  constructor(public minVerbosity: GameLogVerbosity = GameLogVerbosity.Public) {}
  append(entry: GameLogEntry): void {
    if (entry.verbosity <= this.minVerbosity) this.entries.push(entry);
  }
  all(): readonly GameLogEntry[] { return this.entries; }
  filter(v: GameLogVerbosity): GameLogEntry[] { return this.entries.filter(e => e.verbosity <= v); }
  toJSON() { return { minVerbosity: this.minVerbosity, entries: [...this.entries] }; }
  static fromJSON(s: ReturnType<GameLog["toJSON"]>): GameLog {
    const log = new GameLog(s.minVerbosity);
    for (const e of s.entries) log.entries.push(e);
    return log;
  }
}
```

- [ ] **Step 5 (commit):** `git commit -s -m "feat(core): add GameLog types"`

---

### Task 21: Typed error hierarchy

**Files:** `packages/core/src/errors.ts`, `.test.ts`

- [ ] **Step 1 (test):** Each error is instanceof `ForgeError`; has recognizable `.name`; carries its payload fields.

- [ ] **Step 2-4:**

```ts
export abstract class ForgeError extends Error {
  constructor(message: string) { super(message); this.name = new.target.name; }
}

export class UnknownCardError extends ForgeError { constructor(readonly cardName: string) { super(`Unknown card: ${cardName}`); } }
export class UnknownHandlerError extends ForgeError { constructor(readonly handlerKey: string) { super(`Unknown handler: ${handlerKey}`); } }
export class ParseError extends ForgeError { constructor(message: string, readonly location?: { file: string; line: number; column: number }) { super(message); } }
export class ManaParseError extends ParseError {}
export class IncompatibleCardDataError extends ForgeError {}
export class IncompatibleCacheFormatError extends ForgeError {}
export class IncompatibleSnapshotVersionError extends ForgeError {}
export class InvalidDeckError extends ForgeError { constructor(message: string, readonly issues: unknown[]) { super(message); } }
export class DeckContainsUnknownCardError extends ForgeError { constructor(readonly names: string[]) { super(`Deck contains unknown cards: ${names.join(", ")}`); } }
export class UnknownFormatError extends ForgeError {}
export class UnregisteredRuleOverrideError extends ForgeError {}
export class GameStateIntegrityError extends ForgeError {}
export class IllegalDecisionError extends ForgeError { constructor(message: string, readonly legalOptions?: unknown[]) { super(message); } }
export class IllegalCastError extends ForgeError {}
export class SnapshotRestoreError extends ForgeError {}
export class DecisionLogCorruptError extends ForgeError {}
export class UnknownAiProfileError extends ForgeError {}
export class AiTimeBudgetExceededError extends ForgeError {}
```

- [ ] **Step 5 (commit):** `git commit -s -m "feat(core): add typed error hierarchy"`

---

### Task 22: `GameEvent` discriminated union

**Files:** `packages/core/src/events/event.ts`, `.test.ts`

- [ ] **Step 1 (test):** Each event has `kind`, `version: number`, `turn: number`, `phase: PhaseStep`, `payload`. Asserts constructors + shape for a sample (CardDrawn, LifeChanged, DamageDealt, GameEnded).

- [ ] **Step 2-4 (impl):** `GameEvent` is a large discriminated union. Define in a single file with ~60 variants; use a builder helper `event.make("CardDrawn", { ... })`. Group by family (ZoneChange, StateChange, Stack, Combat, Phase, Player, Meta) in the file via comments.

Every event shape: `{ kind: string; version: number; turn: number; phase: PhaseStep; payload: {...} }`. Example:

```ts
export type GameEvent =
  // Zone changes
  | { kind: "CardDrawn"; version: 1; turn: number; phase: PhaseStep; payload: { playerSeat: PlayerSeat; cardId: EntityId } }
  | { kind: "CardDiscarded"; version: 1; turn: number; phase: PhaseStep; payload: { playerSeat: PlayerSeat; cardId: EntityId; cause: "discard" | "effect" | "handSize" } }
  // State changes
  | { kind: "LifeChanged"; version: 1; turn: number; phase: PhaseStep; payload: { playerSeat: PlayerSeat; oldLife: number; newLife: number; delta: number; cause: string } }
  // … etc, 60 total
  ;

export const mkEvent = <K extends GameEvent["kind"]>(
  kind: K, turn: number, phase: PhaseStep, payload: Extract<GameEvent, { kind: K }>["payload"],
): Extract<GameEvent, { kind: K }> =>
  ({ kind, version: 1, turn, phase, payload } as Extract<GameEvent, { kind: K }>);
```

Include all ~60 from SP1 §8: CardDrawn, CardDiscarded, CardMilled, CardDestroyed, CardExiled, CardSacrificed, CardReturned, CardCycled, CardForetold, CardChangedZone, LifeChanged, CounterAdded, CounterRemoved, CardTapped, CardUntapped, ControlChanged, AttachmentChanged, PhasedOut, PhasedIn, Flipped, Transformed, FaceDownStateChanged, BecameMonarch, LostMonarch, BecameInitiative, RingTempted, RingLevelChanged, SpellCast, SpellPutOnStack, AbilityActivated, AbilityTriggered, StackItemResolving, StackItemResolved, StackItemCountered, StackItemCopied, CombatStarted, AttackersDeclared, BlockersDeclared, BlockerOrderSet, DamageAssigned, DamageDealt, DamagePrevented, AttackerBecomesBlocked, CombatEnded, CombatCreatureDied, TurnStarted, TurnEnded, PhaseStarted, StepStarted, StepEnded, PlayerDrew, PlayerDiscarded, PlayerMilled, PlayerLost, PlayerWon, PlayerConceded, CityBlessingGained, GameStarted, MulliganTaken, GameEnded, CastAborted, ShortcutApplied.

- [ ] **Step 5 (commit):** `git commit -s -m "feat(core): add GameEvent discriminated union (~60 events)"`

---

### Task 23: `DecisionRequest` + `DecisionResponse` (PlayerController — 22 kinds)

**Files:** `packages/core/src/decisions/player-decisions.ts`, `.test.ts`

- [ ] **Step 1 (test):** Each of the 22 kinds exists; sample shape check for `priority`, `chooseTargets`, `declareAttackers`, `mulligan`.

- [ ] **Step 2-4:** Define discriminated unions for `DecisionRequest` and `DecisionResponse` matching SP1 §4. Each variant carries the exact fields listed there. Representative example (do this shape for all 22):

```ts
export type PriorityAction =
  | { kind: "castSpell"; cardId: EntityId; zone: ZoneType; altCost?: string; additionalCosts?: string[] }
  | { kind: "activateAbility"; abilityInstanceId: EntityId }
  | { kind: "activateManaAbility"; abilityInstanceId: EntityId }
  | { kind: "pass" }
  | { kind: "concede" }
  | { kind: "requestShortcut"; description: string; result: unknown };

export type DecisionRequest =
  | { kind: "mulligan"; playerSeat: PlayerSeat; currentHand: EntityId[]; mulligansSoFar: number; rule: "london" | "vancouver" | "paris" | "free" }
  | { kind: "priority"; playerSeat: PlayerSeat; legalActions: PriorityAction[] }
  | { kind: "chooseTargets"; sourceId: EntityId; restriction: unknown; min: number; max: number; choicesAllowed: EntityId[] }
  | { kind: "declareAttackers"; playerSeat: PlayerSeat; legalAttackers: EntityId[]; legalDefenders: Array<{ kind: "player"; seat: PlayerSeat } | { kind: "planeswalker"; id: EntityId } | { kind: "battle"; id: EntityId }> }
  // ... 18 more kinds per SP1 §4
  ;

export type DecisionResponse =
  | { kind: "mulligan"; keep: boolean; bottomed?: EntityId[] }
  | { kind: "priority"; action: PriorityAction }
  | { kind: "chooseTargets"; targets: EntityId[] }
  | { kind: "declareAttackers"; attackers: Array<{ attacker: EntityId; defender: { player: PlayerSeat } | { planeswalker: EntityId } | { battle: EntityId } }> }
  // ... 18 more kinds
  ;
```

Include all 22 kinds — enumerate against SP1 §4. The `concede` action in `PriorityAction` is used by the integration smoke test (Task 49).

- [ ] **Step 5 (commit):** `git commit -s -m "feat(core): add PlayerController DecisionRequest/Response (22 kinds)"`

---

### Task 24: `MatchDecisionRequest` + `DraftDecisionRequest`

**Files:** `packages/core/src/decisions/match-decisions.ts`, `packages/core/src/decisions/draft-decisions.ts`, tests.

- [ ] **Step 1 (test):** Match: `sideboard`, `concedeMatch`, `acceptDrawOffer` kinds. Draft: `pick`, `jumpstartPick`, `winstonPile`, `solomonSplit`, `gridPick`, `rochesterPick`, `draftMulligan`.

- [ ] **Step 2-4:** Implement per SP7 §3 and SP1 §4.

- [ ] **Step 5 (commit):** `git commit -s -m "feat(core): add MatchController and DraftPlayerController decision types"`

---

## Milestone H — Core: Views + DSL AST + Image keys

### Task 25: View types (`GameView`, `PlayerView`, `CardView`, `ZoneView`, `StackItemView`, `CombatView`)

**Files:** `packages/core/src/views/*.ts`, tests.

- [ ] **Step 1 (test):** Given a plain-data `GameSnapshotData` input (opponent hand has 3 cards, your hand has 2 cards), `makeGameView(data, seat=0)` returns a view where `view.players[1].hand = { count: 3 }` (opponent — hidden) and `view.players[0].hand = { ids: [id1, id2] }` (own — visible).

- [ ] **Step 2-4:** Views operate on **pure data** (a `GameSnapshotData` shape defined inline here), not live `Game` objects. This avoids forward-referencing the game package. The same data shape is produced later by `GameSnapshot.toJSON()` (Task 42), so views work identically on live state and on restored snapshots.

```ts
// views/types.ts
export interface CardView {
  id: EntityId;
  name?: string;            // omitted for face-down cards when viewer is not the controller
  zone: ZoneType;
  tapped?: boolean;
  counters?: Record<string, number>;
}

export type ZoneContentView =
  | { kind: "visible"; cards: CardView[] }
  | { kind: "hidden"; count: number }
  | { kind: "partiallyVisible"; cards: CardView[]; hiddenCount: number };

export interface PlayerView {
  seat: PlayerSeat;
  life: number;
  zones: Record<ZoneType, ZoneContentView>;
  // ...
}

export interface GameView {
  turn: number;
  phase: PhaseStep;
  activePlayer: PlayerSeat;
  players: PlayerView[];
  stack: CardView[];              // stack items viewed as cards
  // ...
}

// views/make-view.ts
export interface GameSnapshotData {    // local type — matches Task 42's GameSnapshot.state shape
  turn: number; phase: PhaseStep; activePlayer: PlayerSeat;
  players: Array<{ seat: PlayerSeat; life: number; zones: Record<ZoneType, EntityId[]> }>;
  cards: Record<number, { id: EntityId; name: string; zone: ZoneType; tapped: boolean; faceDown: boolean; counters: Record<string, number> }>;
}

export const makeGameView = (data: GameSnapshotData, viewerSeat: PlayerSeat): GameView => {
  // Hidden-info filter: hide opponent hand/library contents; hide face-down card identities except for controller.
};
```

Full wiring to live `Game` objects happens in Task 35 via a `game.viewFor(seat)` method that constructs a `GameSnapshotData` on the fly and delegates to `makeGameView`.

- [ ] **Step 5 (commit):** `git commit -s -m "feat(core): add GameView/PlayerView/CardView/ZoneView projections"`

---

### Task 26: DSL AST types (ParamValue, EffectInvocation, SVarExpressionAst, AbilityAst, TriggerAst, ReplacementAst, StaticAst, KeywordAst, SVarAst, CostAst, TypeLineAst, PtAst, LoyaltyAst, DefenseAst, ManaCostAst)

**Files:** `packages/core/src/dsl/ast.ts`, tests.

- [ ] **Step 1 (test):** Round-trip each AST node type through JSON (shape assertion; SP3 builds the parser).

- [ ] **Step 2-4:** Per SP3 §3 + SP1 §2.1, define:

```ts
export type ParamValue =
  | { kind: "literal"; raw: string }
  | { kind: "svarRef"; name: string }
  | { kind: "expression"; ast: SVarExpressionAst };

export interface SVarExpressionAst { kind: string; args?: SVarExpressionAst[]; raw?: string; }

export interface EffectInvocation {
  handlerKey: string;
  params: Record<string, ParamValue>;
  subAbility?: EffectInvocation;
}

export interface AbilityAst { kind: "spell" | "activated"; effect: EffectInvocation; cost: CostAst; rulesText?: string; timing?: "sorcery" | "instant" | "any"; }
export interface TriggerAst { mode: string; params: Record<string, ParamValue>; effect: EffectInvocation; }
export interface ReplacementAst { eventKind: string; params: Record<string, ParamValue>; effect: EffectInvocation; isSelf?: boolean; }
export interface StaticAst { mode: string; params: Record<string, ParamValue>; activeInZones: ZoneType[]; }
export interface KeywordAst { keyword: string; params?: Record<string, ParamValue>; }
export interface SVarAst { kind: "value" | "ability"; raw: string; expression?: SVarExpressionAst; ability?: EffectInvocation; }
export interface CostAst { raw: string; /* detailed parsed form in SP3 */ }
export interface TypeLineAst { supertypes: string[]; types: string[]; subtypes: string[]; }
export interface PtAst { power: string; toughness: string; }
export interface LoyaltyAst { starting: string; }
export interface DefenseAst { starting: string; }
export interface ManaCostAst { raw: string; symbols: ManaSymbol[]; }
```

- [ ] **Step 5 (commit):** `git commit -s -m "feat(core): add DSL AST type definitions"`

---

### Task 27: `ImageKeys` constants + Scryfall URL builders

**Files:** `packages/core/src/image/image-keys.ts`, `packages/core/src/image/scryfall.ts`, tests.

- [ ] **Step 1 (test):** `imageKeyForCard({name:"Lightning Bolt", set:"LEA", collectorNumber:"161", language:"en"})` returns `"c:Lightning Bolt|LEA|161|en"`. `scryfallImageUrl(paper)` returns a well-formed Scryfall URL (verify prefix `https://cards.scryfall.io/`).

- [ ] **Step 2-4:**

```ts
// image-keys.ts — ported from Forge's ImageKeys
export const PREFIX_CARD = "c:";
export const PREFIX_TOKEN = "t:";
export const PREFIX_ICON = "i:";
export const PREFIX_BOOSTER = "b:";
export const PREFIX_FATPACK = "f:";
export const PREFIX_BOOSTERBOX = "x:";
export const PREFIX_PRECON = "p:";
export const PREFIX_TOURNAMENTPACK = "o:";
export const PREFIX_ADVENTURECARD = "a:";
export const BACKFACE_POSTFIX = "$alt";
export const SPECFACE_W = "$wspec";
export const SPECFACE_U = "$uspec";
export const SPECFACE_B = "$bspec";
export const SPECFACE_R = "$rspec";
export const SPECFACE_G = "$gspec";
export const HIDDEN_CARD = "hidden";
export const MORPH_IMAGE = "morph";
export const MANIFEST_IMAGE = "manifest";
export const CLOAKED_IMAGE = "cloaked";
export const FORETELL_IMAGE = "foretell";
export const THE_RING_IMAGE = "the_ring";
// …etc for all Forge-declared image keys.

export const imageKeyForCard = (p: PaperCard): string =>
  `${PREFIX_CARD}${p.name}|${p.set}|${p.collectorNumber}|${p.language}`;
```

```ts
// scryfall.ts — URL construction ported from Forge's ImageUtil.getScryfallDownloadUrl
const BASE = "https://cards.scryfall.io";
export type ScryfallFace = "front" | "back";
export type ScryfallCrop = "small" | "normal" | "large" | "png" | "art_crop" | "border_crop";
export const scryfallImageUrl = (p: PaperCard, opts: { face?: ScryfallFace; crop?: ScryfallCrop; lang?: string } = {}): string => {
  const face = opts.face ?? "front";
  const crop = opts.crop ?? "normal";
  const lang = opts.lang ?? p.language;
  const setLower = p.set.toLowerCase();
  const cn = p.collectorNumber;
  return `${BASE}/${crop}/${face}/${setLower.slice(0, 1)}/${setLower.slice(1, 2)}/${setLower}-${cn}-${lang}.jpg`;
};
```

**Note:** the `scryfallImageUrl` body above is a placeholder. Port the exact URL construction from Forge's `forge-core/src/main/java/forge/util/ImageUtil.java#getScryfallDownloadUrl` — Scryfall's canonical URLs use the Scryfall UUID, not set+collector-number paths. `PaperCard.scryfallId` must be populated for this builder to work; throw `UnknownCardError` if missing.

- [ ] **Step 5 (commit):** `git commit -s -m "feat(core): add ImageKeys constants and Scryfall URL builders"`

---

### Task 28: `FormatDefinition` interface (shape only)

**Files:** `packages/core/src/format/format-definition.ts`, tests.

- [ ] **Step 1 (test):** Construct a minimal `FormatDefinition` literal; serialize; round-trip.

- [ ] **Step 2-4:** Define the interface per SP6 §2. Concrete definitions live in `@mtg-forge-ts/formats` (SP6).

- [ ] **Step 5 (commit):** `git commit -s -m "feat(core): add FormatDefinition interface"`

---

### Task 29: `LobbyPlayer` + misc shared types

**Files:** `packages/core/src/lobby-player.ts`, tests.

- [ ] **Step 1-4:**

```ts
export interface LobbyPlayer {
  id: string;                           // stable identity across games
  name: string;
  avatar?: string;
  controllerKind: "human" | "ai" | "scripted" | "randomLegal" | "remote";
}
```

- [ ] **Step 5 (commit):** `git commit -s -m "feat(core): add LobbyPlayer type"`

---

### Task 30: Re-export everything from `packages/core/src/index.ts`

- [ ] **Step 1:** Update `index.ts` to re-export all modules: ids, color, zone, phase, counter-type, mana/*, cost/*, card/*, deck/*, rng/*, errors, events/event, decisions/*, views/*, dsl/ast, image/*, format/format-definition, lobby-player.

- [ ] **Step 2:** Run `pnpm -F @mtg-forge-ts/core build` to confirm DTS generation succeeds.

- [ ] **Step 3 (commit):** `git commit -s -m "refactor(core): re-export public surface from index"`

---

## Milestone I — Game package: scaffold

### Task 31: Game-scaffold registry stubs

**Files:** `packages/game/src/registries/*.ts`, tests.

Each registry is the same Map-backed pattern (`register`, `get`, `list`, `remove`). Full implementation: `TriggerRegistry`, `ReplacementRegistry`, `StaticEffectRegistry`, `EffectRegistry`, `KeywordRegistry`, `AltCostRegistry`, `RuleOverrideRegistry`. SP1 ships shells; SP2/SP3 populate.

- [ ] **Step 1 (test):** Round-trip register → get → list → remove for each registry (empty is fine).

- [ ] **Step 2-4 (impl, shared template):**

```ts
// registries/generic-registry.ts
export class GenericRegistry<T> {
  private map = new Map<string, T>();
  register(key: string, value: T): void { this.map.set(key, value); }
  get(key: string): T | undefined { return this.map.get(key); }
  list(): T[] { return [...this.map.values()]; }
  remove(key: string): boolean { return this.map.delete(key); }
}
```

One thin wrapper per registry type in its own file for naming discoverability.

- [ ] **Step 5 (commit):** `git commit -s -m "feat(game): scaffold engine registries"`

---

### Task 32: `Zone` class hierarchy (in-memory contents)

**Files:** `packages/game/src/zone/zone.ts`, `packages/game/src/zone/zones/*.ts`, tests.

- [ ] **Step 1-4:**

```ts
export abstract class Zone {
  protected readonly items: EntityId[] = [];
  constructor(readonly type: ZoneType, readonly ownerSeat: PlayerSeat | null) {}
  get size(): number { return this.items.length; }
  add(cardId: EntityId, index = this.items.length): void { this.items.splice(index, 0, cardId); }
  remove(cardId: EntityId): boolean {
    const i = this.items.indexOf(cardId);
    if (i < 0) return false;
    this.items.splice(i, 1);
    return true;
  }
  contains(cardId: EntityId): boolean { return this.items.includes(cardId); }
  toArray(): EntityId[] { return [...this.items]; }
  clear(): void { this.items.length = 0; }
  toJSON() { return { type: this.type, ownerSeat: this.ownerSeat, items: [...this.items] }; }
}

export class Library extends Zone {}
export class Hand extends Zone {}
export class Graveyard extends Zone {}
export class Battlefield extends Zone {}
export class Exile extends Zone {}
export class CommandZone extends Zone {}
export class Ante extends Zone {}
// …
```

**Note:** `Stack` is *not* a subclass of `Zone` — it holds `StackItem` objects rather than `EntityId`s, so the base `Zone.items: EntityId[]` shape doesn't fit. The stack is a separate class defined in Task 37. `ZoneType.Stack` still exists as a marker in the enum for rules that reference "the stack" as a zone (per CR 400.1).

- [ ] **Step 5 (commit):** `git commit -s -m "feat(game): add Zone class hierarchy"`

---

### Task 33: `Card` (live) + `Player` (live)

**Files:** `packages/game/src/card.ts`, `packages/game/src/player.ts`, tests.

- [ ] **Step 1-4:**

```ts
// card.ts
export class Card {
  constructor(
    readonly id: EntityId,
    readonly paperCard: PaperCard,
    public ownerSeat: PlayerSeat,
    public controllerSeat: PlayerSeat,
    public zone: ZoneType,
  ) {}
  tapped = false;
  phased = false;
  damage = 0;
  counters = new Map<CounterType, number>();
  attachedTo: EntityId | null = null;
  attachments: EntityId[] = [];
  copiedFrom: unknown | null = null;     // typed by SP2 (CopiableCharacteristics)
  faceDown: unknown | null = null;       // typed by SP2 (FaceDownState discriminated union)
  // toJSON / fromJSON symmetric to field set.
}
```

```ts
// player.ts
export class Player {
  constructor(
    readonly seat: PlayerSeat,
    readonly lobbyPlayer: LobbyPlayer,
    public teamId: number,
  ) {}
  life = 20;                            // overwritten by GameRules at setup
  counters = new Map<CounterType, number>();    // poison, energy, experience, rad, etc.
  manaPool: unknown = null;             // ManaPool (Task 36)
  zones = new Map<ZoneType, Zone>();    // per-player zones
  // Serialization methods follow the same pattern.
}
```

- [ ] **Step 5 (commit):** `git commit -s -m "feat(game): add live Card and Player classes"`

---

### Task 34: `GameRules` + `GameMeta`

**Files:** `packages/game/src/game-rules.ts`, `packages/game/src/game-meta.ts`, tests.

- [ ] **Step 1-4:**

```ts
// game-meta.ts
export interface GameMeta {
  engineVersion: string;
  forgeSha: string;
  cardDataSyncedAt: string;
  crVersion: string;
  seed: string;       // bigint as hex
}

// game-rules.ts
export interface GameRules {
  formatId: string;
  startingLife: number;
  startingHandSize: number;
  mulliganRule: "london" | "vancouver" | "paris" | "free";
  firstPlayerSkipsDraw: boolean;
  ruleOverrides: string[];
  playerCount: { min: number; max: number };
  teamAssignments?: number[];    // seat → teamId; omit for free-for-all
}
```

- [ ] **Step 5 (commit):** `git commit -s -m "feat(game): add GameRules and GameMeta interfaces"`

---

### Task 35: `Game` class skeleton

**Files:** `packages/game/src/game.ts`, tests.

- [ ] **Step 1 (test):** Construct a `Game` with 2 `LobbyPlayer`s, `GameRules`, seed; `game.turn === 1`, `game.activePlayer === seat 0`, `game.getPlayer(0)` returns the first player.

- [ ] **Step 2-4:**

```ts
export class Game {
  readonly meta: GameMeta;
  readonly rules: GameRules;
  readonly rng: Rng;
  private entityIdCounter = 0;
  turn = 1;
  phase: PhaseStep = PhaseStep.Untap;
  activePlayer: PlayerSeat = mkPlayerSeat(0);
  priorityPlayer: PlayerSeat | null = null;
  readonly players: Player[];
  readonly sharedZones: { stack: Stack; exile: Exile; ante: Ante };
  readonly flags: GameFlags;
  terminalState: TerminalState | null = null;

  constructor(opts: { lobbyPlayers: LobbyPlayer[]; rules: GameRules; meta: GameMeta; rng: Rng }) {
    this.rules = opts.rules;
    this.meta = opts.meta;
    this.rng = opts.rng;
    this.players = opts.lobbyPlayers.map((lp, i) => new Player(mkPlayerSeat(i), lp, opts.rules.teamAssignments?.[i] ?? i));
    this.sharedZones = { stack: new Stack(ZoneType.Stack, null), exile: new Exile(ZoneType.Exile, null), ante: new Ante(ZoneType.Ante, null) };
    this.flags = createDefaultFlags();
  }

  newEntityId(): EntityId { return mkEntityId(this.entityIdCounter++); }
  getPlayer(seat: PlayerSeat): Player {
    const p = this.players[seat as unknown as number];
    if (!p) throw new GameStateIntegrityError(`No player at seat ${seat}`);
    return p;
  }
  isTerminal(): boolean { return this.terminalState !== null; }
}
```

Also define `GameFlags` + `createDefaultFlags()` + `TerminalState` in sibling files:

```ts
// game-flags.ts — per SP1 §5
export interface GameFlags {
  dayNight: "day" | "night" | "neither";
  monarch: PlayerSeat | null;
  initiative: PlayerSeat | null;
  cityBlessing: Set<PlayerSeat>;
  ringBearer: Map<PlayerSeat, EntityId | null>;
  ringLevel: Map<PlayerSeat, 0 | 1 | 2 | 3 | 4>;
  speedLevel: Map<PlayerSeat, 0 | 1 | 2 | 3 | 4>;
  currentDungeon: Map<PlayerSeat, { card: EntityId; position: string } | null>;
  commandersOwnedByPlayer: Map<PlayerSeat, EntityId[]>;
  commanderCastCount: Map<EntityId, number>;
  commanderDamage: Map<EntityId, Map<PlayerSeat, number>>;
  firstTurnDrawSkipped: Map<PlayerSeat, boolean>;
  mulligansTaken: Map<PlayerSeat, number>;
  landsPlayedThisTurn: Map<PlayerSeat, number>;
  spellsCastThisTurn: Map<PlayerSeat, number>;
  turnsTakenThisTurn: number;
  skippedPhases: PhaseStep[];
  activeTeamForTeamPlay: number | null;
  seatEliminated: Map<PlayerSeat, boolean>;
  stickers: unknown[];                  // StickerSheet — typed in SP7
  attractions: Map<PlayerSeat, unknown>;
}

export const createDefaultFlags = (): GameFlags => ({
  dayNight: "neither",
  monarch: null,
  initiative: null,
  cityBlessing: new Set(),
  ringBearer: new Map(),
  ringLevel: new Map(),
  speedLevel: new Map(),
  currentDungeon: new Map(),
  commandersOwnedByPlayer: new Map(),
  commanderCastCount: new Map(),
  commanderDamage: new Map(),
  firstTurnDrawSkipped: new Map(),
  mulligansTaken: new Map(),
  landsPlayedThisTurn: new Map(),
  spellsCastThisTurn: new Map(),
  turnsTakenThisTurn: 0,
  skippedPhases: [],
  activeTeamForTeamPlay: null,
  seatEliminated: new Map(),
  stickers: [],
  attractions: new Map(),
});
```

Also add `Game.attachCardDb(db: unknown): void` stub — throws `new Error("SP4 CardDb integration required")` for now. The real compatibility check lands in SP4.

- [ ] **Step 5 (commit):** `git commit -s -m "feat(game): add Game class skeleton with GameFlags"`

---

### Task 36: `ManaPool` + `ManaCostSolver` (stub)

**Files:** `packages/game/src/mana/mana-pool.ts`, `packages/game/src/mana/mana-cost-solver.ts`, tests.

- [ ] **Step 1-4:**

```ts
export class ManaPool {
  private shards: ManaShard[] = [];
  add(s: ManaShard): void { this.shards.push(s); }
  empty(): void { this.shards.length = 0; }
  snapshot(): ManaShard[] { return [...this.shards]; }
  restore(snap: ManaShard[]): void { this.shards = [...snap]; }
  size(): number { return this.shards.length; }
  // removeForPayment + canPay stubs throw "not yet implemented" — filled by SP3's cost system
}
```

`ManaCostSolver` is a shell class with `canPay(cost, player, game): boolean { throw new Error("SP3"); }`.

- [ ] **Step 5 (commit):** `git commit -s -m "feat(game): scaffold ManaPool and ManaCostSolver"`

---

### Task 37: `Stack` class (live) + `StackItem`

**Files:** `packages/game/src/stack/stack.ts`, `packages/game/src/stack/stack-item.ts`, tests.

- [ ] **Step 1-4:**

```ts
export interface StackItemProvenance {
  originZone: ZoneType;
  altCostUsed: string | null;
  additionalCostsPaid: string[];
  cascadeOrigin?: EntityId;
  copiedFrom?: EntityId;
  alternativeZoneDestination?: ZoneType;
}

export interface StackItem {
  id: EntityId;
  sourceCardId: EntityId;
  controllerSeat: PlayerSeat;
  kind: "spell" | "activatedAbility" | "triggeredAbility" | "copy";
  isCast: boolean;
  targets: unknown;       // TargetChoices — stub in SP1, typed in SP2
  modes: unknown[];
  xValue: number | null;
  costPaid: unknown;      // PaidCost — stub in SP1
  provenance: StackItemProvenance;
}

// Stack is a separate class (NOT a Zone subclass) because it holds StackItem objects, not EntityIds.
export class Stack {
  private readonly items: StackItem[] = [];
  readonly type: ZoneType = ZoneType.Stack;
  push(item: StackItem): void { this.items.push(item); }
  pop(): StackItem | undefined { return this.items.pop(); }
  top(): StackItem | undefined { return this.items[this.items.length - 1]; }
  get size(): number { return this.items.length; }
  toArray(): StackItem[] { return [...this.items]; }
  toJSON() { return { items: [...this.items] }; }
}
```

- [ ] **Step 5 (commit):** `git commit -s -m "feat(game): add Stack class and StackItem type"`

---

### Task 38: `GameAction` mutation scaffold

**Files:** `packages/game/src/action/game-action.ts`, tests.

SP1 provides generator-based method signatures with minimal bodies that mutate state + emit events but do not run replacements or triggers (those come in SP2).

- [ ] **Step 1 (test):** `action.drawCards(seat, 1)` advances an EntityId from library to hand, emits `CardDrawn` event. `action.changeLife(seat, -2)` decreases life, emits `LifeChanged` with `delta: -2`.

- [ ] **Step 2-4:**

```ts
export type EngineYield =
  | { kind: "decision"; request: DecisionRequest }
  | { kind: "event"; event: GameEvent };

export class GameAction {
  constructor(private readonly game: Game) {}

  *drawCards(seat: PlayerSeat, count: number, opts: { source?: EntityId } = {}): Generator<EngineYield, void, DecisionResponse> {
    const player = this.game.getPlayer(seat);
    const lib = player.zones.get(ZoneType.Library)!;
    const hand = player.zones.get(ZoneType.Hand)!;
    for (let i = 0; i < count; i++) {
      const drawn = lib.toArray()[lib.size - 1];
      if (drawn === undefined) { /* TODO SP2: set empty-library SBA flag */ continue; }
      lib.remove(drawn);
      hand.add(drawn);
      yield { kind: "event", event: mkEvent("CardDrawn", this.game.turn, this.game.phase, { playerSeat: seat, cardId: drawn }) };
    }
  }

  *changeLife(seat: PlayerSeat, delta: number, opts: { source?: EntityId } = {}): Generator<EngineYield, void, DecisionResponse> {
    const player = this.game.getPlayer(seat);
    const old = player.life;
    player.life += delta;
    yield { kind: "event", event: mkEvent("LifeChanged", this.game.turn, this.game.phase, { playerSeat: seat, oldLife: old, newLife: player.life, delta, cause: "action" }) };
  }

  *moveTo(cardId: EntityId, toZone: ZoneType, opts: { cause?: string } = {}): Generator<EngineYield, void, DecisionResponse> {
    // SP1: simple zone-move without replacements/triggers. SP2 adds replacement chain + trigger queueing.
    const { fromZone, owner } = this.locate(cardId);
    const srcZone = this.zoneFor(fromZone, owner);
    const dstZone = this.zoneFor(toZone, toZone === ZoneType.Stack || toZone === ZoneType.Exile || toZone === ZoneType.Ante ? null : owner);
    srcZone.remove(cardId);
    dstZone.add(cardId);
    yield { kind: "event", event: mkEvent("CardChangedZone", this.game.turn, this.game.phase, { cardId, fromZone, toZone, cause: opts.cause ?? "move" }) };
  }

  private locate(cardId: EntityId): { fromZone: ZoneType; owner: PlayerSeat | null } {
    // Check shared zones first
    for (const [key, zone] of Object.entries(this.game.sharedZones)) {
      if ((zone as Zone).contains(cardId)) {
        return { fromZone: (zone as Zone).type, owner: null };
      }
    }
    // Then per-player zones
    for (const player of this.game.players) {
      for (const zone of player.zones.values()) {
        if (zone.contains(cardId)) {
          return { fromZone: zone.type, owner: player.seat };
        }
      }
    }
    throw new GameStateIntegrityError(`Card ${cardId} not found in any zone`);
  }

  private zoneFor(t: ZoneType, owner: PlayerSeat | null): Zone {
    if (owner === null) {
      if (t === ZoneType.Stack) return this.game.sharedZones.stack;
      if (t === ZoneType.Exile) return this.game.sharedZones.exile;
      if (t === ZoneType.Ante) return this.game.sharedZones.ante;
      throw new GameStateIntegrityError(`Zone ${t} requires an owner`);
    }
    const zone = this.game.getPlayer(owner).zones.get(t);
    if (!zone) throw new GameStateIntegrityError(`Player ${owner} has no zone ${t}`);
    return zone;
  }
}
```

Add stubs for the remaining mutation methods (`tap`, `untap`, `destroy`, `exile`, `sacrifice`, `damage`, `addCounter`, `removeCounter`, `changeControl`, `putOnStack`, `createToken`, `createEmblem`, `mill`, `scry`, `surveil`, `proliferate`, `shuffle`) each emitting the corresponding event; full implementations live in SP2.

- [ ] **Step 5 (commit):** `git commit -s -m "feat(game): scaffold GameAction generator-based mutators"`

---

### Task 39: `PhaseHandler` + `TurnQueue` + `PhaseSequence`

**Files:** `packages/game/src/phase/*.ts`, tests.

- [ ] **Step 1 (test):** `PhaseHandler.advance()` emits `PhaseStarted` / `StepStarted` / `TurnStarted` events in canonical order. `TurnQueue.pushExtra` + `pop` yields the extra turn before the next scheduled turn.

- [ ] **Step 2-4:**

```ts
// turn-queue.ts
export interface Turn { activePlayer: PlayerSeat; isExtra: boolean; }
export class TurnQueue {
  private q: Turn[] = [];
  push(t: Turn): void { this.q.push(t); }
  pushExtra(t: Turn): void { this.q.unshift(t); }
  pop(): Turn | undefined { return this.q.shift(); }
  injectSkip(count = 1): void { for (let i = 0; i < count; i++) this.q.unshift({ activePlayer: mkPlayerSeat(-1), isExtra: false }); }
  peekNext(): Turn | undefined { return this.q[0]; }
  get length(): number { return this.q.length; }
}

// phase-sequence.ts
export class PhaseSequence {
  private steps: PhaseStep[] = [...canonicalPhaseSequence];
  getSteps(): readonly PhaseStep[] { return this.steps; }
  injectExtraCombat(): void {
    const idx = this.steps.indexOf(PhaseStep.EndOfCombat);
    if (idx < 0) return;
    this.steps.splice(idx + 1, 0, PhaseStep.BeginCombat, PhaseStep.DeclareAttackers, PhaseStep.DeclareBlockers, PhaseStep.CombatDamage, PhaseStep.EndOfCombat);
  }
  skipStep(s: PhaseStep): void { this.steps = this.steps.filter(x => x !== s); }
  isSkipped(s: PhaseStep): boolean { return !this.steps.includes(s); }
}

// phase-handler.ts — generator that walks PhaseSequence step by step, emitting events
export class PhaseHandler {
  constructor(private readonly game: Game) {}
  *runPhase(): Generator<EngineYield, void, DecisionResponse> { /* emit PhaseStarted/StepStarted/StepEnded/PhaseEnded */ }
  *performTurnBasedActions(step: PhaseStep, active: PlayerSeat): Generator<EngineYield, void, DecisionResponse> { /* per-step actions */ }
}
```

- [ ] **Step 5 (commit):** `git commit -s -m "feat(game): add PhaseHandler, TurnQueue, PhaseSequence"`

---

### Task 40: `TargetSystem` scaffold

**Files:** `packages/game/src/target/target-system.ts`, tests.

- [ ] **Step 1-4:** Minimal shape — `TargetChoices` interface + `TargetSystem` class with `validateAtCast(stub)` / `validateAtResolve(stub)` methods throwing "SP2". Enough for `StackItem.targets` typing.

```ts
export interface TargetChoices {
  targets: EntityId[];
  divisions?: Record<number, number>;   // for "divide X damage" — target index → amount
}

export class TargetSystem {
  validateAtCast(_choices: TargetChoices, _sourceId: EntityId): boolean {
    throw new Error("TargetSystem validation implemented in SP2");
  }
  validateAtResolve(_choices: TargetChoices, _sourceId: EntityId): { legal: EntityId[]; illegal: EntityId[] } {
    throw new Error("TargetSystem validation implemented in SP2");
  }
}
```

- [ ] **Step 5 (commit):** `git commit -s -m "feat(game): scaffold TargetSystem"`

---

### Task 40b: `CombatHandler` + `CombatState` scaffold

**Files:** `packages/game/src/combat/combat-state.ts`, `packages/game/src/combat/combat-handler.ts`, tests.

SP1 §2.1 names `CombatHandler` + `CombatState` as scaffolded in this sub-project (full logic in SP2). Per SP2, `CombatHandler` is the sole mutator of `CombatState` (not `GameAction`), so it deserves its own class even at scaffold stage.

- [ ] **Step 1 (test):** Construct a `CombatState`; call `declareAttackers([])` with empty attackers (no-op); combat state reflects empty attacker map; `toJSON` round-trips.

- [ ] **Step 2-4:**

```ts
// combat-state.ts
export interface AttackerInfo {
  attackerId: EntityId;
  defender: { kind: "player"; seat: PlayerSeat } | { kind: "planeswalker"; id: EntityId } | { kind: "battle"; id: EntityId };
  isTapped: boolean;
}

export interface BlockerInfo {
  blockerId: EntityId;
  attackerIds: EntityId[];    // may block multiple in banding / melee
}

export interface CombatState {
  attackers: Map<EntityId, AttackerInfo>;
  blockers: Map<EntityId, BlockerInfo>;
  blockerOrdering: Map<EntityId, EntityId[]>;   // attackerId → ordered blockers for damage assignment
  damageAssignments: Map<EntityId, Array<{ targetId: EntityId; amount: number }>>;
  firstStrikeSplitActive: boolean;
}

export const createCombatState = (): CombatState => ({
  attackers: new Map(),
  blockers: new Map(),
  blockerOrdering: new Map(),
  damageAssignments: new Map(),
  firstStrikeSplitActive: false,
});

// combat-handler.ts
export class CombatHandler {
  constructor(private readonly game: Game, public state: CombatState = createCombatState()) {}

  *declareAttackers(choices: Array<{ attackerId: EntityId; defender: AttackerInfo["defender"] }>): Generator<EngineYield, void, DecisionResponse> {
    // SP1: record attackers, tap unless vigilance. Full restriction/requirement enforcement in SP2.
    for (const c of choices) {
      this.state.attackers.set(c.attackerId, { attackerId: c.attackerId, defender: c.defender, isTapped: false });
    }
    yield { kind: "event", event: mkEvent("AttackersDeclared", this.game.turn, this.game.phase, { attackers: choices }) };
  }

  *declareBlockers(_choices: unknown): Generator<EngineYield, void, DecisionResponse> {
    throw new Error("Full declareBlockers implementation in SP2");
    yield { kind: "event", event: {} as never };   // unreachable; satisfies generator typing
  }

  *dealCombatDamage(): Generator<EngineYield, void, DecisionResponse> {
    throw new Error("Full combat damage resolution in SP2");
    yield { kind: "event", event: {} as never };
  }

  reset(): void { this.state = createCombatState(); }
}
```

- [ ] **Step 5 (commit):** `git commit -s -m "feat(game): scaffold CombatHandler and CombatState"`

---

### Task 41: `Match` + `MatchController` interface

**Files:** `packages/game/src/match/match.ts`, tests.

- [ ] **Step 1-4:** Per SP1 §15. Include `bestOf`, game list, score tracking, `sideboardingFlow()` generator stub.

- [ ] **Step 5 (commit):** `git commit -s -m "feat(game): add Match and MatchController scaffold"`

---

### Task 42: `GameSnapshot` + `snapshot` / `restore`

**Files:** `packages/game/src/snapshot/game-snapshot.ts`, tests.

- [ ] **Step 1 (test):** Construct a game, take a snapshot, mutate state, restore snapshot, assert round-trip equality on serialized form.

- [ ] **Step 2-4:**

```ts
export interface GameSnapshotHeader {
  schemaVersion: number;
  engineVersion: string;
  forgeSha: string;
  cardDataSyncedAt: string;
  crVersion: string;
  savedAt: string;
  formatId: string;
  formatDefinitionSnapshot: unknown;    // FormatDefinition — populated when SP6 attached
  seed: string;
}

export interface GameSnapshot {
  header: GameSnapshotHeader;
  state: {
    turn: number;
    phase: PhaseStep;
    activePlayer: PlayerSeat;
    players: ReturnType<Player["toJSON"]>[];
    sharedZones: { stack: unknown; exile: unknown; ante: unknown };
    flags: GameFlags;
    rngState: { s0: string; s1: string; s2: string; s3: string };    // bigint → hex string
    entityIdCounter: number;
  };
}

export const snapshot = (game: Game): GameSnapshot => { /* walk state */ };
export const restore = (snap: GameSnapshot, lobbyPlayers: LobbyPlayer[]): Game => { /* rebuild, controllers re-bound externally */ };
```

- [ ] **Step 5 (commit):** `git commit -s -m "feat(game): add GameSnapshot serialize/restore"`

---

### Task 43: `DecisionLog`

**Files:** `packages/game/src/decision-log.ts`, tests.

- [ ] **Step 1-4:**

```ts
export interface DecisionRecord { id: DecisionId; request: DecisionRequest; response: DecisionResponse; }
export class DecisionLog {
  private records: DecisionRecord[] = [];
  private next = 0;
  append(request: DecisionRequest, response: DecisionResponse): DecisionId {
    const id = mkDecisionId(this.next++);
    this.records.push({ id, request, response });
    return id;
  }
  toArray(): DecisionRecord[] { return [...this.records]; }
  toJSON() { return this.records.map(r => ({ id: r.id, request: r.request, response: r.response })); }
}
```

- [ ] **Step 5 (commit):** `git commit -s -m "feat(game): add DecisionLog"`

---

### Task 44: `PlayerController` interface + `ScriptedController` + `RandomLegalController`

**Files:** `packages/game/src/controller/*.ts`, tests.

- [ ] **Step 1 (test):** `ScriptedController` returns pre-recorded responses in order; errors if it runs out. `RandomLegalController` picks the first legal option deterministically given a seeded RNG.

- [ ] **Step 2-4:**

```ts
// controller.ts
export interface PlayerController { decide(req: DecisionRequest): DecisionResponse; }
export interface MatchController { decide(req: MatchDecisionRequest): MatchDecisionResponse; }

// scripted-controller.ts
export class ScriptedController implements PlayerController {
  private i = 0;
  constructor(private readonly script: DecisionResponse[]) {}
  decide(_req: DecisionRequest): DecisionResponse {
    const r = this.script[this.i++];
    if (!r) throw new DecisionLogCorruptError("Scripted controller ran out of responses");
    return r;
  }
}

// random-legal-controller.ts
export class RandomLegalController implements PlayerController {
  constructor(private readonly rng: Rng) {}
  decide(req: DecisionRequest): DecisionResponse {
    // For each request kind, pick a default legal response.
    // SP1: stubs covering "priority" (→ pass) and "mulligan" (→ keep) minimum.
    switch (req.kind) {
      case "priority": return { kind: "priority", action: { kind: "pass" } };
      case "mulligan": return { kind: "mulligan", keep: true };
      default: throw new IllegalDecisionError(`RandomLegalController: ${req.kind} not yet implemented`);
    }
  }
}
```

Full coverage of all 22 decision kinds in SP2.

- [ ] **Step 5 (commit):** `git commit -s -m "feat(game): add PlayerController + Scripted + RandomLegal"`

---

### Task 45: Game setup flow scaffold (mulligan + opening hand)

**Files:** `packages/game/src/setup/setup-flow.ts`, tests.

- [ ] **Step 1 (test):** `*setupGame(game, controllers)` generator runs through: shuffle libraries, draw starting hands, yield mulligan decisions, emit `GameStarted` event. With `ScriptedController`s that always keep, completes successfully.

- [ ] **Step 2-4:** Implement generator per SP1 §6. SP1 covers London mulligan only; Vancouver/Paris/Free in SP2.

- [ ] **Step 5 (commit):** `git commit -s -m "feat(game): add game setup generator with London mulligan"`

---

### Task 46: Game-end flow + `TerminalState`

**Files:** `packages/game/src/end/terminal-state.ts`, tests.

- [ ] **Step 1-4:**

```ts
export interface TerminalState {
  endedAt: { turn: number; phase: PhaseStep };
  outcome:
    | { kind: "win"; winner: PlayerSeat; reason: string }
    | { kind: "teamWin"; teamId: number; reason: string }
    | { kind: "draw"; reason: string };
  concededSeats: PlayerSeat[];
}

export const endGame = (game: Game, outcome: TerminalState["outcome"]): void => {
  game.terminalState = { endedAt: { turn: game.turn, phase: game.phase }, outcome, concededSeats: [] };
  // Event emission handled by caller.
};
```

SP2 adds the SBA-driven game-end detection loop.

- [ ] **Step 5 (commit):** `git commit -s -m "feat(game): add TerminalState and endGame helper"`

---

### Task 47: Lint rule — forbid ambient randomness + clock in `@mtg-forge-ts/game`

**Files:** `biome.json` (extend), or a bespoke check in `tools/lint-rules/` if biome doesn't support custom rules by 5.x.

- [ ] **Step 1 (test):** Golden violation test — a file containing `Math.random()` fails; a file using `game.rng.nextFloat()` passes.

- [ ] **Step 2-4:** Use biome's `noGlobalObjectCalls` + a grep-based CI check for banned tokens scoped to `packages/game/` and `packages/ai/` (until biome supports full custom rules). Script lives in `tools/lint-rules/check-determinism.ts` and runs in CI after biome.

Install dependency first: `pnpm add -Dw globby tsx` (at repo root, since this is a devtool).

```ts
// tools/lint-rules/check-determinism.ts
import { readFileSync } from "node:fs";
import { globby } from "globby";
const BANNED = [/Math\.random\s*\(/, /Date\.now\s*\(/, /new Date\s*\(/, /crypto\.randomUUID\s*\(/];
const files = await globby(["packages/game/src/**/*.ts", "packages/ai/src/**/*.ts"]);
let violations = 0;
for (const f of files) {
  const src = readFileSync(f, "utf8");
  for (const rx of BANNED) {
    if (rx.test(src)) { console.error(`${f}: ambient randomness/clock use matches ${rx}`); violations++; }
  }
}
process.exit(violations ? 1 : 0);
```

Add to root `package.json` scripts: `"lint:determinism": "tsx tools/lint-rules/check-determinism.ts"`. Include in `ci.yaml` after `pnpm lint`.

**Why `globby` not `fs.globSync`:** Node's built-in `fs.globSync` is only stable in Node 22. Plan targets Node 20 LTS minimum, so a third-party glob is required.

- [ ] **Step 5 (commit):** `git commit -s -m "ci: forbid ambient randomness and wall-clock in game+ai packages"`

---

### Task 48: Re-export `@mtg-forge-ts/game` public surface

**Files:** `packages/game/src/index.ts`

- [ ] **Step 1:** Re-export Game, Player, Card, Zone classes, GameAction, PhaseHandler, Match, GameSnapshot helpers, controllers, DecisionLog, setup flow, TerminalState, registries.

- [ ] **Step 2:** `pnpm -F @mtg-forge-ts/game build` clean.

- [ ] **Step 3 (commit):** `git commit -s -m "refactor(game): re-export public surface from index"`

---

### Task 49: Integration smoke test — scripted no-op game

**Files:** `packages/game/test/integration/scripted-game.test.ts`

- [ ] **Step 1 (test):**

```ts
import { describe, expect, it } from "vitest";
import { SeededRng, mkPlayerSeat } from "@mtg-forge-ts/core";
import { Game, ScriptedController, setupGame, /* …*/ } from "../../src/index.js";

describe("scripted no-op game", () => {
  it("runs to terminal state when both players concede on their first priority", async () => {
    const rng = new SeededRng(0x1234n);
    const game = new Game({
      lobbyPlayers: [
        { id: "p0", name: "P0", controllerKind: "scripted" },
        { id: "p1", name: "P1", controllerKind: "scripted" },
      ],
      rules: {
        formatId: "casual",
        startingLife: 20,
        startingHandSize: 7,
        mulliganRule: "london",
        firstPlayerSkipsDraw: true,
        ruleOverrides: [],
        playerCount: { min: 2, max: 2 },
      },
      meta: { engineVersion: "0.0.0", forgeSha: "test", cardDataSyncedAt: "2026-04-23", crVersion: "2026-03-17", seed: "0x1234" },
      rng,
    });

    const controllers = new Map<number, PlayerController>([
      [0, new ScriptedController([
        { kind: "mulligan", keep: true },
        { kind: "priority", action: { kind: "concede" } },
      ])],
      [1, new ScriptedController([
        { kind: "mulligan", keep: true },
      ])],
    ]);

    // Drive setup + one priority window
    const gen = runGame(game, controllers);
    let step = gen.next();
    while (!step.done) {
      if (step.value.kind === "decision") {
        const seat = (step.value.request as { playerSeat: PlayerSeat }).playerSeat;
        step = gen.next(controllers.get(seat as unknown as number)!.decide(step.value.request));
      } else {
        step = gen.next();
      }
    }
    expect(game.isTerminal()).toBe(true);
    expect(game.terminalState?.outcome.kind).toBe("win");
  });
});
```

- [ ] **Step 2:** Create `packages/game/src/run-game.ts`:

```ts
// SPDX-License-Identifier: GPL-3.0-or-later
import type { Game } from "./game.js";
import type { PlayerController, MatchController } from "./controller/controller.js";
import type { PlayerSeat, DecisionResponse } from "@mtg-forge-ts/core";
import { setupGame } from "./setup/setup-flow.js";
import { PhaseHandler } from "./phase/phase-handler.js";
import { endGame } from "./end/terminal-state.js";
import type { EngineYield } from "./action/game-action.js";

export function* runGame(
  game: Game,
  controllers: Map<PlayerSeat, PlayerController>,
): Generator<EngineYield, void, DecisionResponse> {
  yield* setupGame(game, controllers);
  const phaseHandler = new PhaseHandler(game);
  while (!game.isTerminal()) {
    yield* phaseHandler.runPhase();
  }
}
```

- [ ] **Step 3:** Add `export * from "./run-game.js";` to `packages/game/src/index.ts`.

- [ ] **Step 4:** Handle `concede` priority action in `PhaseHandler.runPhase`: when a controller returns `{kind: "priority", action: {kind: "concede"}}`, call `endGame(game, {kind: "win", winner: otherSeat, reason: "concession"})`. Emit `PlayerConceded` and `GameEnded` events.

- [ ] **Step 5 (commit):** `git commit -s -m "test(game): scripted no-op game runs to terminal state"`

---

### Task 50: Changeset + version bump prep

**Files:** `.changeset/config.json`, `.changeset/sp1-initial-scaffolding.md`

- [ ] **Step 1:** `pnpm dlx @changesets/cli init`. Edit `.changeset/config.json` to add `baseBranch: "main"`, `access: "restricted"` (npm publish deferred; local-only publishing is fine for v0).

- [ ] **Step 2:** Create changeset:

```markdown
---
"@mtg-forge-ts/core": minor
"@mtg-forge-ts/game": minor
---

feat: SP1 engine foundations — monorepo scaffolding, core types (ids, mana, cost, deck, DSL AST, views, events, decisions, errors, Rng), game scaffold (Zone, Card, Player, Game, GameAction, PhaseHandler, ManaPool, Stack, Match, snapshot/restore, controllers, setup flow, terminal state), determinism lint rule, integration smoke test.
```

- [ ] **Step 3 (commit):** `git commit -s -m "chore: add changeset for SP1 scaffolding"`

---

## Self-review checklist

After executing, verify:

1. **Spec coverage** — SP1 §18 phases 1a–1t all have tasks: 1a (Tasks 8–12), 1b (13–19), 1c (26), 1d (20, 20b), 1e (25), 1f (22, 23, 24), 1g (21), 1h (31–35), 1i (38), 1j (39), 1k (37), 1l (36, 38), 1m (41), 1n (42), 1o (43, 44), 1p (44), 1q (45), 1r (46), 1s (47), 1t (49). Plus cross-cutting: CombatHandler scaffold (40b), GameLog (20b), ImageKeys/Scryfall (27), FormatDefinition (28), LobbyPlayer (29), registries (31), TargetSystem (40), re-exports (30, 48), changeset (50).
2. **Package contracts** — `@mtg-forge-ts/core` builds clean ESM+CJS+DTS; `@mtg-forge-ts/game` imports core cleanly.
3. **Determinism** — no ambient randomness in `game/` (lint rule enforces).
4. **Serialization** — every class in stored state has `toJSON`; `GameSnapshot` round-trips.
5. **Integration** — Task 49 passes: scripted game runs to terminal state.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-04-23-sp1-engine-foundations.md`. Two execution options:

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

**Which approach?**
