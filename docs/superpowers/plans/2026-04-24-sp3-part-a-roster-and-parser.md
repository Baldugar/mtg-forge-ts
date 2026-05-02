# SP3 Part A — Forge-Roster Expansion + DSL Parser Foundation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land the Forge-roster structural expansions deferred from the SP2 Round 1 audit (B-C1 through B-C5 + KeywordId), then build the DSL parser that converts Forge `.txt` card scripts into validated `CardDefinition` ASTs.

**Architecture:**
- **M0** extends existing core enums to full Forge fidelity without breaking SP2's 1844 tests. Each expansion is additive (new enum values, new typed intent variants, new static-ability mode) with thin adapter wiring to existing dispatch. No semantic change to any passing test.
- **M1** creates the `@mtg-forge-ts/cards` workspace and builds the five-stage DSL parser (lexer → per-prefix line parsers → AST assembler → face/SVar resolver → `CardDefinition` output). Parser emits into core's existing `dsl/ast.ts` types; no runtime handler dispatch yet (that's SP3 Part B+).

**Tech Stack:** TypeScript strict (noUncheckedIndexedAccess, exactOptionalPropertyTypes, verbatimModuleSyntax), pnpm workspaces, vitest, fast-check, tsup (esm+cjs), biome. Ported from `F:\BACKUP\Programacion\forge\` (read-only reference).

**Non-negotiable invariants (carry forward from SP1/SP2):**
- Generator-based engine. No Promise/async inside `function*`.
- Three mutators: GameAction / CombatHandler / subsystem-internal.
- Entity-ID refs; deep `readonly` on union variants.
- `kind:` discriminator + `readonly version: 1` on every event; exhaustiveness guards on every `switch (x.kind)`.
- Deterministic Rng only (CI enforced).
- `git commit -s`; no `Co-Authored-By` (user global rule).
- SPDX headers; `.js` imports; `import type`; strict TS flags.
- Forge-fidelity wins over plan: if Forge's shape differs from this plan, apply Forge's and document.

**Branch:** stay on `sp1-engine-foundations` (legacy name; carries SP2 + SP3).

**Commit policy:** after every task. Run full gate before milestone boundary commits: `pnpm typecheck && pnpm test && pnpm build && pnpm lint && pnpm lint:determinism`.

---

## Milestone M0 — Forge-roster structural prerequisites

Fixes deferred SP2 Round 1 audit findings B-C1 through B-C5 + KeywordId (B-C7). All additive; no existing test should change in meaning.

### Task 1: MulliganRule — add `original` and `houston`

**Files:**
- Modify: `packages/core/src/format/format-definition.ts:54`
- Test: `packages/core/src/format/format-definition.test.ts` (create if missing)

**Forge reference:** `forge-game/src/main/java/forge/game/player/MulliganService.java` + `forge-core/src/main/java/forge/deck/mulligan/MulliganDefs.java` — five rules total: `PARIS`, `VANCOUVER`, `LONDON`, `ORIGINAL`, `HOUSTON`. (`"free"` is a TS-native mulligan rule used by the sandbox harness — keep it.)

- [ ] **Step 1: Write the failing test**

Create `packages/core/src/format/format-definition.test.ts`:

```ts
// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, it, expect } from "vitest";
import type { MulliganRule } from "./format-definition.js";

describe("MulliganRule", () => {
  it("accepts all five WOTC rules plus the TS-native 'free' rule", () => {
    const rules: MulliganRule[] = ["london", "vancouver", "paris", "original", "houston", "free"];
    // Compile-time check; runtime assertion prevents dead-code elimination.
    expect(rules).toHaveLength(6);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @mtg-forge-ts/core test format-definition`
Expected: type error `Type '"original"' is not assignable to type 'MulliganRule'.`

- [ ] **Step 3: Extend the union**

Edit `packages/core/src/format/format-definition.ts:54`:

```ts
export type MulliganRule = "london" | "vancouver" | "paris" | "original" | "houston" | "free";
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @mtg-forge-ts/core test format-definition`
Expected: PASS.

- [ ] **Step 5: Full gate**

Run: `pnpm typecheck && pnpm --filter @mtg-forge-ts/core test`
Expected: all 626+ core tests pass.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/format/format-definition.ts packages/core/src/format/format-definition.test.ts
git commit -s -m "feat(core): expand MulliganRule to 6 kinds (B-C1)

Forge supports five official rules (Paris, Vancouver, London, Original,
Houston). Our union previously had 3 + TS-native 'free'. Add 'original'
and 'houston' per Forge MulliganDefs."
```

---

### Task 2: KeywordId string-literal union (~197 entries) + display metadata

**Files:**
- Create: `packages/core/src/card/keyword-id.ts`
- Modify: `packages/core/src/card/index.ts` (add export)
- Test: `packages/core/src/card/keyword-id.test.ts`

**Forge reference:** `forge-game/src/main/java/forge/game/keyword/Keyword.java` (enum from `ABSORB` through `MAYFLASHSAC`, skipping `UNDEFINED`). Each entry has `displayName`, `type` (KeywordInstance subclass indicating parameterization: `SimpleKeyword`, `KeywordWithAmount`, `KeywordWithCost`, `KeywordWithType`, `KeywordWithCostAndAmount`, `KeywordWithCostAndType`, plus per-keyword custom classes), `isMultipleRedundant`, `reminderText`.

Canonical TS id = `lowercase_snake_case` of the Java enum name (e.g. `FIRST_STRIKE` → `"first_strike"`). This matches existing usage in `combat-handler.ts` (`"first_strike"`, `"double_strike"`, `"lifelink"`, `"indestructible"`).

- [ ] **Step 1: Write the failing test**

Create `packages/core/src/card/keyword-id.test.ts`:

```ts
// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, it, expect } from "vitest";
import {
  KEYWORD_IDS,
  keywordDisplayName,
  keywordIsMultipleRedundant,
  keywordIdFromDisplayName,
  type KeywordId,
} from "./keyword-id.js";

describe("KeywordId", () => {
  it("covers the full Forge roster (>=196 entries excluding UNDEFINED)", () => {
    expect(KEYWORD_IDS.length).toBeGreaterThanOrEqual(196);
  });

  it("round-trips canonical ids through displayName", () => {
    expect(keywordDisplayName("first_strike")).toBe("First Strike");
    expect(keywordDisplayName("double_strike")).toBe("Double Strike");
    expect(keywordDisplayName("flying")).toBe("Flying");
    expect(keywordDisplayName("bands_with_other")).toBe("Bands with other");
    expect(keywordDisplayName("jump_start")).toBe("Jump-start");
    expect(keywordDisplayName("more_than_meets_the_eye")).toBe("More Than Meets the Eye");
  });

  it("parses display name back into canonical id (case-insensitive)", () => {
    expect(keywordIdFromDisplayName("Flying")).toBe("flying");
    expect(keywordIdFromDisplayName("FLYING")).toBe("flying");
    expect(keywordIdFromDisplayName("First Strike")).toBe("first_strike");
    expect(keywordIdFromDisplayName("Jump-start")).toBe("jump_start");
    expect(keywordIdFromDisplayName("not-a-real-keyword")).toBeNull();
  });

  it("encodes isMultipleRedundant flag (Flying redundant, Ward not)", () => {
    expect(keywordIsMultipleRedundant("flying")).toBe(true);
    expect(keywordIsMultipleRedundant("ward")).toBe(false);
    expect(keywordIsMultipleRedundant("first_strike")).toBe(true);
  });

  it("every canonical id resolves via displayName round-trip", () => {
    for (const id of KEYWORD_IDS) {
      const display = keywordDisplayName(id);
      const back: KeywordId | null = keywordIdFromDisplayName(display);
      expect(back).toBe(id);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @mtg-forge-ts/core test keyword-id`
Expected: FAIL — `Cannot find module './keyword-id.js'`.

- [ ] **Step 3: Create the keyword-id module**

Create `packages/core/src/card/keyword-id.ts` (full enumeration below; fields: `id`, `displayName`, `multipleRedundant`):

```ts
// SPDX-License-Identifier: GPL-3.0-or-later
// KeywordId — canonical identifier for every MTG keyword ability Forge tracks.
// Source of truth: forge/forge-game/src/main/java/forge/game/keyword/Keyword.java
// Canonical form: lowercase_snake_case of the Java enum name. Keep in sync on
// upstream syncs; PR is blocked if a vendored card K: line references an
// unknown KeywordId.
//
// Numbers below match the Forge Keyword enum as of 2026-04-24.

interface KeywordMeta {
  readonly id: string;
  readonly displayName: string;
  readonly multipleRedundant: boolean;
}

const META: readonly KeywordMeta[] = [
  { id: "absorb", displayName: "Absorb", multipleRedundant: false },
  { id: "affinity", displayName: "Affinity", multipleRedundant: false },
  { id: "afflict", displayName: "Afflict", multipleRedundant: false },
  { id: "afterlife", displayName: "Afterlife", multipleRedundant: false },
  { id: "aftermath", displayName: "Aftermath", multipleRedundant: false },
  { id: "amplify", displayName: "Amplify", multipleRedundant: false },
  { id: "annihilator", displayName: "Annihilator", multipleRedundant: false },
  { id: "ascend", displayName: "Ascend", multipleRedundant: true },
  { id: "assist", displayName: "Assist", multipleRedundant: true },
  { id: "aura_swap", displayName: "Aura swap", multipleRedundant: false },
  { id: "awaken", displayName: "Awaken", multipleRedundant: false },
  { id: "backup", displayName: "Backup", multipleRedundant: false },
  { id: "banding", displayName: "Banding", multipleRedundant: true },
  { id: "bands_with_other", displayName: "Bands with other", multipleRedundant: false },
  { id: "bargain", displayName: "Bargain", multipleRedundant: false },
  { id: "battle_cry", displayName: "Battle cry", multipleRedundant: false },
  { id: "bestow", displayName: "Bestow", multipleRedundant: false },
  { id: "blitz", displayName: "Blitz", multipleRedundant: false },
  { id: "bloodthirst", displayName: "Bloodthirst", multipleRedundant: false },
  { id: "bushido", displayName: "Bushido", multipleRedundant: false },
  { id: "buyback", displayName: "Buyback", multipleRedundant: false },
  { id: "cascade", displayName: "Cascade", multipleRedundant: false },
  { id: "casualty", displayName: "Casualty", multipleRedundant: false },
  { id: "champion", displayName: "Champion", multipleRedundant: false },
  { id: "changeling", displayName: "Changeling", multipleRedundant: true },
  { id: "choose_a_background", displayName: "Choose a Background", multipleRedundant: true },
  { id: "cipher", displayName: "Cipher", multipleRedundant: true },
  { id: "companion", displayName: "Companion", multipleRedundant: true },
  { id: "compleated", displayName: "Compleated", multipleRedundant: true },
  { id: "conspire", displayName: "Conspire", multipleRedundant: false },
  { id: "convoke", displayName: "Convoke", multipleRedundant: true },
  { id: "craft", displayName: "Craft", multipleRedundant: false },
  { id: "crew", displayName: "Crew", multipleRedundant: false },
  { id: "cumulative_upkeep", displayName: "Cumulative upkeep", multipleRedundant: false },
  { id: "cycling", displayName: "Cycling", multipleRedundant: false },
  { id: "dash", displayName: "Dash", multipleRedundant: false },
  { id: "daybound", displayName: "Daybound", multipleRedundant: true },
  { id: "deathtouch", displayName: "Deathtouch", multipleRedundant: true },
  { id: "decayed", displayName: "Decayed", multipleRedundant: true },
  { id: "defender", displayName: "Defender", multipleRedundant: true },
  { id: "delve", displayName: "Delve", multipleRedundant: true },
  { id: "demonstrate", displayName: "Demonstrate", multipleRedundant: false },
  { id: "dethrone", displayName: "Dethrone", multipleRedundant: false },
  { id: "devour", displayName: "Devour", multipleRedundant: false },
  { id: "devoid", displayName: "Devoid", multipleRedundant: true },
  { id: "disguise", displayName: "Disguise", multipleRedundant: false },
  { id: "disturb", displayName: "Disturb", multipleRedundant: false },
  { id: "doctors_companion", displayName: "Doctor's companion", multipleRedundant: true },
  { id: "double_agenda", displayName: "Double agenda", multipleRedundant: false },
  { id: "double_strike", displayName: "Double Strike", multipleRedundant: true },
  { id: "double_team", displayName: "Double team", multipleRedundant: false },
  { id: "dredge", displayName: "Dredge", multipleRedundant: false },
  { id: "echo", displayName: "Echo", multipleRedundant: false },
  { id: "embalm", displayName: "Embalm", multipleRedundant: false },
  { id: "emerge", displayName: "Emerge", multipleRedundant: false },
  { id: "enchant", displayName: "Enchant", multipleRedundant: false },
  { id: "encore", displayName: "Encore", multipleRedundant: false },
  { id: "enlist", displayName: "Enlist", multipleRedundant: false },
  { id: "entwine", displayName: "Entwine", multipleRedundant: true },
  { id: "epic", displayName: "Epic", multipleRedundant: true },
  { id: "equip", displayName: "Equip", multipleRedundant: false },
  { id: "escape", displayName: "Escape", multipleRedundant: false },
  { id: "escalate", displayName: "Escalate", multipleRedundant: true },
  { id: "eternalize", displayName: "Eternalize", multipleRedundant: false },
  { id: "evoke", displayName: "Evoke", multipleRedundant: false },
  { id: "evolve", displayName: "Evolve", multipleRedundant: false },
  { id: "exalted", displayName: "Exalted", multipleRedundant: false },
  { id: "exploit", displayName: "Exploit", multipleRedundant: false },
  { id: "extort", displayName: "Extort", multipleRedundant: false },
  { id: "fabricate", displayName: "Fabricate", multipleRedundant: false },
  { id: "fading", displayName: "Fading", multipleRedundant: false },
  { id: "fear", displayName: "Fear", multipleRedundant: true },
  { id: "firebending", displayName: "Firebending", multipleRedundant: false },
  { id: "first_strike", displayName: "First Strike", multipleRedundant: true },
  { id: "flanking", displayName: "Flanking", multipleRedundant: false },
  { id: "flash", displayName: "Flash", multipleRedundant: true },
  { id: "flashback", displayName: "Flashback", multipleRedundant: false },
  { id: "flying", displayName: "Flying", multipleRedundant: true },
  { id: "for_mirrodin", displayName: "For Mirrodin", multipleRedundant: false },
  { id: "foretell", displayName: "Foretell", multipleRedundant: false },
  { id: "fortify", displayName: "Fortify", multipleRedundant: false },
  { id: "freerunning", displayName: "Freerunning", multipleRedundant: false },
  { id: "frenzy", displayName: "Frenzy", multipleRedundant: false },
  { id: "fuse", displayName: "Fuse", multipleRedundant: true },
  { id: "gift", displayName: "Gift", multipleRedundant: true },
  { id: "graft", displayName: "Graft", multipleRedundant: false },
  { id: "gravestorm", displayName: "Gravestorm", multipleRedundant: false },
  { id: "harmonize", displayName: "Harmonize", multipleRedundant: false },
  { id: "haste", displayName: "Haste", multipleRedundant: true },
  { id: "haunt", displayName: "Haunt", multipleRedundant: false },
  { id: "hexproof", displayName: "Hexproof", multipleRedundant: true },
  { id: "hideaway", displayName: "Hideaway", multipleRedundant: false },
  { id: "hidden_agenda", displayName: "Hidden agenda", multipleRedundant: false },
  { id: "horsemanship", displayName: "Horsemanship", multipleRedundant: true },
  { id: "impending", displayName: "Impending", multipleRedundant: false },
  { id: "improvise", displayName: "Improvise", multipleRedundant: true },
  { id: "indestructible", displayName: "Indestructible", multipleRedundant: true },
  { id: "infect", displayName: "Infect", multipleRedundant: true },
  { id: "ingest", displayName: "Ingest", multipleRedundant: false },
  { id: "intimidate", displayName: "Intimidate", multipleRedundant: true },
  { id: "kicker", displayName: "Kicker", multipleRedundant: false },
  { id: "job_select", displayName: "Job select", multipleRedundant: false },
  { id: "jump_start", displayName: "Jump-start", multipleRedundant: false },
  { id: "landwalk", displayName: "Landwalk", multipleRedundant: true },
  { id: "level_up", displayName: "Level up", multipleRedundant: false },
  { id: "lifelink", displayName: "Lifelink", multipleRedundant: true },
  { id: "living_metal", displayName: "Living metal", multipleRedundant: true },
  { id: "living_weapon", displayName: "Living Weapon", multipleRedundant: true },
  { id: "madness", displayName: "Madness", multipleRedundant: false },
  { id: "mayhem", displayName: "Mayhem", multipleRedundant: false },
  { id: "melee", displayName: "Melee", multipleRedundant: false },
  { id: "mentor", displayName: "Mentor", multipleRedundant: false },
  { id: "menace", displayName: "Menace", multipleRedundant: true },
  { id: "megamorph", displayName: "Megamorph", multipleRedundant: false },
  { id: "miracle", displayName: "Miracle", multipleRedundant: false },
  { id: "mobilize", displayName: "Mobilize", multipleRedundant: false },
  { id: "modular", displayName: "Modular", multipleRedundant: false },
  { id: "more_than_meets_the_eye", displayName: "More Than Meets the Eye", multipleRedundant: false },
  { id: "morph", displayName: "Morph", multipleRedundant: false },
  { id: "multikicker", displayName: "Multikicker", multipleRedundant: false },
  { id: "mutate", displayName: "Mutate", multipleRedundant: true },
  { id: "myriad", displayName: "Myriad", multipleRedundant: false },
  { id: "nightbound", displayName: "Nightbound", multipleRedundant: true },
  { id: "ninjutsu", displayName: "Ninjutsu", multipleRedundant: false },
  { id: "outlast", displayName: "Outlast", multipleRedundant: false },
  { id: "offering", displayName: "Offering", multipleRedundant: false },
  { id: "offspring", displayName: "Offspring", multipleRedundant: false },
  { id: "overload", displayName: "Overload", multipleRedundant: false },
  { id: "partner", displayName: "Partner", multipleRedundant: true },
  { id: "partner_with", displayName: "Partner with", multipleRedundant: false },
  { id: "persist", displayName: "Persist", multipleRedundant: false },
  { id: "phasing", displayName: "Phasing", multipleRedundant: true },
  { id: "plot", displayName: "Plot", multipleRedundant: false },
  { id: "poisonous", displayName: "Poisonous", multipleRedundant: false },
  { id: "protection", displayName: "Protection", multipleRedundant: true },
  { id: "prototype", displayName: "Prototype", multipleRedundant: false },
  { id: "provoke", displayName: "Provoke", multipleRedundant: false },
  { id: "prowess", displayName: "Prowess", multipleRedundant: false },
  { id: "prowl", displayName: "Prowl", multipleRedundant: false },
  { id: "rampage", displayName: "Rampage", multipleRedundant: false },
  { id: "ravenous", displayName: "Ravenous", multipleRedundant: false },
  { id: "reach", displayName: "Reach", multipleRedundant: true },
  { id: "read_ahead", displayName: "Read ahead", multipleRedundant: true },
  { id: "rebound", displayName: "Rebound", multipleRedundant: true },
  { id: "recover", displayName: "Recover", multipleRedundant: false },
  { id: "reconfigure", displayName: "Reconfigure", multipleRedundant: false },
  { id: "reflect", displayName: "Reflect", multipleRedundant: false },
  { id: "reinforce", displayName: "Reinforce", multipleRedundant: false },
  { id: "renown", displayName: "Renown", multipleRedundant: false },
  { id: "replicate", displayName: "Replicate", multipleRedundant: false },
  { id: "retrace", displayName: "Retrace", multipleRedundant: false },
  { id: "riot", displayName: "Riot", multipleRedundant: false },
  { id: "ripple", displayName: "Ripple", multipleRedundant: false },
  { id: "saddle", displayName: "Saddle", multipleRedundant: false },
  { id: "scavenge", displayName: "Scavenge", multipleRedundant: false },
  { id: "shadow", displayName: "Shadow", multipleRedundant: true },
  { id: "shroud", displayName: "Shroud", multipleRedundant: true },
  { id: "skulk", displayName: "Skulk", multipleRedundant: true },
  { id: "sneak", displayName: "Sneak", multipleRedundant: false },
  { id: "soulbond", displayName: "Soulbond", multipleRedundant: true },
  { id: "soulshift", displayName: "Soulshift", multipleRedundant: false },
  { id: "space_sculptor", displayName: "Space sculptor", multipleRedundant: true },
  { id: "specialize", displayName: "Specialize", multipleRedundant: false },
  { id: "spectacle", displayName: "Spectacle", multipleRedundant: false },
  { id: "splice", displayName: "Splice", multipleRedundant: false },
  { id: "split_second", displayName: "Split second", multipleRedundant: true },
  { id: "spree", displayName: "Spree", multipleRedundant: true },
  { id: "squad", displayName: "Squad", multipleRedundant: false },
  { id: "start_your_engines", displayName: "Start your engines", multipleRedundant: true },
  { id: "starting_intensity", displayName: "Starting intensity", multipleRedundant: true },
  { id: "station", displayName: "Station", multipleRedundant: false },
  { id: "storm", displayName: "Storm", multipleRedundant: false },
  { id: "strive", displayName: "Strive", multipleRedundant: false },
  { id: "sunburst", displayName: "Sunburst", multipleRedundant: false },
  { id: "surge", displayName: "Surge", multipleRedundant: false },
  { id: "suspend", displayName: "Suspend", multipleRedundant: false },
  { id: "tiered", displayName: "Tiered", multipleRedundant: true },
  { id: "toxic", displayName: "Toxic", multipleRedundant: false },
  { id: "training", displayName: "Training", multipleRedundant: false },
  { id: "trample", displayName: "Trample", multipleRedundant: true },
  { id: "transfigure", displayName: "Transfigure", multipleRedundant: false },
  { id: "transmute", displayName: "Transmute", multipleRedundant: false },
  { id: "tribute", displayName: "Tribute", multipleRedundant: false },
  { id: "typecycling", displayName: "TypeCycling", multipleRedundant: false },
  { id: "umbra_armor", displayName: "Umbra armor", multipleRedundant: true },
  { id: "undaunted", displayName: "Undaunted", multipleRedundant: false },
  { id: "undying", displayName: "Undying", multipleRedundant: false },
  { id: "unearth", displayName: "Unearth", multipleRedundant: false },
  { id: "unleash", displayName: "Unleash", multipleRedundant: false },
  { id: "vanishing", displayName: "Vanishing", multipleRedundant: false },
  { id: "vigilance", displayName: "Vigilance", multipleRedundant: true },
  { id: "ward", displayName: "Ward", multipleRedundant: false },
  { id: "warp", displayName: "Warp", multipleRedundant: false },
  { id: "web_slinging", displayName: "Web-slinging", multipleRedundant: false },
  { id: "wither", displayName: "Wither", multipleRedundant: true },
  { id: "mayflashcost", displayName: "MayFlashCost", multipleRedundant: false },
  { id: "mayflashsac", displayName: "MayFlashSac", multipleRedundant: false },
] as const satisfies readonly KeywordMeta[];

export const KEYWORD_IDS = META.map((m) => m.id) as readonly KeywordMeta["id"][];

export type KeywordId = (typeof META)[number]["id"];

const BY_ID = new Map<string, KeywordMeta>(META.map((m) => [m.id, m]));
const BY_DISPLAY_LOWER = new Map<string, KeywordId>(
  META.map((m) => [m.displayName.toLowerCase(), m.id as KeywordId]),
);

export const isKeywordId = (value: string): value is KeywordId => BY_ID.has(value);

export const keywordDisplayName = (id: KeywordId): string => {
  const meta = BY_ID.get(id);
  if (!meta) throw new Error(`unknown KeywordId: ${id}`);
  return meta.displayName;
};

export const keywordIsMultipleRedundant = (id: KeywordId): boolean => {
  const meta = BY_ID.get(id);
  if (!meta) throw new Error(`unknown KeywordId: ${id}`);
  return meta.multipleRedundant;
};

export const keywordIdFromDisplayName = (name: string): KeywordId | null =>
  BY_DISPLAY_LOWER.get(name.toLowerCase()) ?? null;
```

- [ ] **Step 4: Export from card index**

Edit `packages/core/src/card/index.ts`:

```ts
// SPDX-License-Identifier: GPL-3.0-or-later
export * from "./types.js";
export * from "./card-definition.js";
export * from "./face-definition.js";
export * from "./keyword-id.js";
export * from "./paper-card.js";
```

- [ ] **Step 5: Run tests**

Run: `pnpm --filter @mtg-forge-ts/core test keyword-id`
Expected: PASS (5 tests including the round-trip over ~197 ids).

- [ ] **Step 6: Full gate + commit**

Run: `pnpm typecheck && pnpm --filter @mtg-forge-ts/core test && pnpm --filter @mtg-forge-ts/core build`
Then:

```bash
git add packages/core/src/card/keyword-id.ts packages/core/src/card/keyword-id.test.ts packages/core/src/card/index.ts
git commit -s -m "feat(core): add KeywordId enum with 197 Forge-roster entries (B-C7)

Canonical lowercase_snake_case ids, displayName metadata, and
multipleRedundant flag mirror forge.game.keyword.Keyword. Round-trip
invariant enforced by property test over every id. Unblocks SP3 parser
emitting structured KeywordAst."
```

---

### Task 3: Wire `KeywordId` into `KeywordAst`

**Files:**
- Modify: `packages/core/src/dsl/ast.ts:74-77`
- Test: `packages/core/src/dsl/ast.test.ts` (create)

**Context:** `KeywordAst.keyword` is currently `string`. Tighten to `KeywordId` so the parser must produce a recognized keyword or fail loudly. Parser (Task 21) does the lookup via `keywordIdFromDisplayName`.

- [ ] **Step 1: Write the failing test**

Create `packages/core/src/dsl/ast.test.ts`:

```ts
// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, it, expectTypeOf } from "vitest";
import type { KeywordAst } from "./ast.js";
import type { KeywordId } from "../card/keyword-id.js";

describe("KeywordAst", () => {
  it("requires KeywordId, not raw string", () => {
    const ast: KeywordAst = { keyword: "flying" };
    expectTypeOf(ast.keyword).toEqualTypeOf<KeywordId>();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @mtg-forge-ts/core test dsl/ast`
Expected: TS error `Type 'string' does not satisfy the constraint 'KeywordId'`.

- [ ] **Step 3: Update KeywordAst**

Edit `packages/core/src/dsl/ast.ts:74-77`:

```ts
import type { KeywordId } from "../card/keyword-id.js";

// ... existing types above ...

export interface KeywordAst {
  readonly keyword: KeywordId;
  readonly params?: Readonly<Record<string, ParamValue>>;
}
```

- [ ] **Step 4: Run full typecheck**

Run: `pnpm typecheck`
Expected: PASS — no existing test consumes `KeywordAst.keyword` as a raw `string`, so the tightening is transparent. If something breaks, inspect and migrate inline.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/dsl/ast.ts packages/core/src/dsl/ast.test.ts
git commit -s -m "feat(core): KeywordAst.keyword is KeywordId, not raw string

Type-narrow the DSL AST's keyword slot so parser (SP3 M1) must emit a
canonical KeywordId. Illegal K: lines fail at parse time, not at effect
dispatch."
```

---

### Task 4: `ReplacementLayer` enum (CR 616 tie-breaking)

**Files:**
- Create: `packages/core/src/abilities/replacement-layer.ts`
- Modify: `packages/core/src/abilities/replacement-ability.ts` (add `layer` field)
- Modify: `packages/core/src/abilities/index.ts` (export)
- Test: `packages/core/src/abilities/replacement-layer.test.ts`

**Forge reference:** CR 616.1 — replacements apply in this order when multiple are generated for the same event: (a) affected-player chooses among self-replacements of the affected permanent, (b) then effects that modify "can't happen"/prevention, (c) then effects that modify control, (d) then effects that modify copy, (e) then effects that modify transform, (f) then all others. The ordering is partial (all-others is a single bucket); within a bucket the affected-player/controller/AP tiebreak from CR 616.1 applies.

Forge's `ReplacementLayer` is inferred by scanning effect text patterns (damage-prevention → CantHappen, control-change → Control, copy → Copy, transform → Transform, everything else → Other). Our replacement-orderer currently does a single player-driven order choice without layer partitioning. Task adds the field; Task 9 wires it into the orderer's bucket partition.

- [ ] **Step 1: Write the failing test**

Create `packages/core/src/abilities/replacement-layer.test.ts`:

```ts
// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, it, expect } from "vitest";
import { REPLACEMENT_LAYERS, replacementLayerOrder, type ReplacementLayer } from "./replacement-layer.js";

describe("ReplacementLayer", () => {
  it("enumerates the five CR 616.1 layers in canonical order", () => {
    expect(REPLACEMENT_LAYERS).toEqual(["cantHappen", "control", "copy", "transform", "other"]);
  });

  it("assigns strictly ascending integer ranks", () => {
    const ranks = REPLACEMENT_LAYERS.map(replacementLayerOrder);
    expect(ranks).toEqual([0, 1, 2, 3, 4]);
  });

  it("comparator puts cantHappen before other", () => {
    const cmp = (a: ReplacementLayer, b: ReplacementLayer) => replacementLayerOrder(a) - replacementLayerOrder(b);
    const layers: ReplacementLayer[] = ["other", "cantHappen", "control", "transform", "copy"];
    layers.sort(cmp);
    expect(layers).toEqual(["cantHappen", "control", "copy", "transform", "other"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @mtg-forge-ts/core test replacement-layer`
Expected: FAIL — module not found.

- [ ] **Step 3: Create the module**

Create `packages/core/src/abilities/replacement-layer.ts`:

```ts
// SPDX-License-Identifier: GPL-3.0-or-later
// CR 616.1 — replacement-effect ordering layers. When multiple replacements
// apply to the same event, the replacement-orderer partitions them into
// layer buckets and applies within-layer tiebreak (affected-player /
// controller / AP) inside each bucket. Canonical order: cantHappen →
// control → copy → transform → other.
//
// Forge inference (forge-game ReplacementEffect.getLayer): scan the
// replacement's text/class for prevention/cant-happen patterns → cantHappen;
// ReplaceControl → control; ReplaceCopy → copy; ReplaceTransform →
// transform; everything else → other.

export const REPLACEMENT_LAYERS = ["cantHappen", "control", "copy", "transform", "other"] as const;

export type ReplacementLayer = (typeof REPLACEMENT_LAYERS)[number];

const ORDER: Record<ReplacementLayer, number> = {
  cantHappen: 0,
  control: 1,
  copy: 2,
  transform: 3,
  other: 4,
};

export const replacementLayerOrder = (layer: ReplacementLayer): number => ORDER[layer];
```

- [ ] **Step 4: Add `layer` to ReplacementAbility**

Edit `packages/core/src/abilities/replacement-ability.ts`:

```ts
// SPDX-License-Identifier: GPL-3.0-or-later
import type { AbilityBase } from "./active-ability.js";
import type { ReplacementLayer } from "./replacement-layer.js";

export type MutationIntent = Readonly<Record<string, unknown>> & { readonly kind: string };

export interface ReplacementAbility extends AbilityBase {
  readonly kind: "replacement";
  matches(intent: MutationIntent): boolean;
  apply(intent: MutationIntent, game: unknown): MutationIntent | null;
  readonly isSelfReplacement: boolean;
  // CR 616.1 — layer bucket for multi-replacement ordering. Defaults to
  // "other" for replacements that pre-date this field; SP3 card ports
  // classify explicitly.
  readonly layer: ReplacementLayer;
}
```

- [ ] **Step 5: Migrate existing ReplacementAbility instantiations**

Run: `pnpm --filter @mtg-forge-ts/game typecheck`
Expected: errors at every `ReplacementAbility` literal/constructor call site. At each site, add `layer: "other"` (safe default). Typical sites (grep for `kind: "replacement"`):

```bash
# Enumerate sites to edit
grep -rn '"replacement"' packages/game/src --include="*.ts" | grep -v "\.test\." | grep -v "\.property\."
```

At each hit, add `layer: "other"` to the ReplacementAbility literal. Do NOT change replacement-generating statics or test fixtures yet — those will be touched in Task 9.

- [ ] **Step 6: Export from abilities index**

Edit `packages/core/src/abilities/index.ts`, add:

```ts
export * from "./replacement-layer.js";
```

- [ ] **Step 7: Full gate**

Run: `pnpm typecheck && pnpm test`
Expected: all existing tests still pass (1844 → 1844+).

- [ ] **Step 8: Commit**

```bash
git add packages/core/src/abilities/replacement-layer.ts packages/core/src/abilities/replacement-layer.test.ts packages/core/src/abilities/replacement-ability.ts packages/core/src/abilities/index.ts packages/game/src
git commit -s -m "feat(core): add ReplacementLayer enum for CR 616.1 ordering (B-C2)

Five canonical layers (cantHappen, control, copy, transform, other).
Every ReplacementAbility now carries layer; defaults to 'other' for
pre-existing replacements. replacement-orderer bucket partition wired
in Task 9."
```

---

### Task 5: `ReplacementType` enum (39 Forge kinds) + intent-kind mapping

**Files:**
- Create: `packages/core/src/abilities/replacement-type.ts`
- Modify: `packages/core/src/abilities/index.ts` (export)
- Test: `packages/core/src/abilities/replacement-type.test.ts`

**Forge reference:** `forge-game/src/main/java/forge/game/replacement/ReplacementType.java` — 39 entries. The enum is the replacement's **trigger kind** (what game event it listens for), not its effect. Our MutationIntent union (Task 6) is the matching engine-side shape; ReplacementType is the DSL-side identifier.

- [ ] **Step 1: Write the failing test**

Create `packages/core/src/abilities/replacement-type.test.ts`:

```ts
// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, it, expect } from "vitest";
import { REPLACEMENT_TYPES, replacementTypeFromName, type ReplacementType } from "./replacement-type.js";

describe("ReplacementType", () => {
  it("enumerates 39 Forge replacement kinds", () => {
    expect(REPLACEMENT_TYPES).toHaveLength(39);
  });

  it("includes all CR 614-relevant kinds", () => {
    const required: ReplacementType[] = [
      "AddCounter", "AssembleContraption", "AssignDealDamage", "Attached",
      "BeginPhase", "BeginTurn", "Cascade", "Counter", "CopySpell", "CreateToken",
      "DamageDone", "DealtDamage", "DeclareBlocker", "Destroy", "Draw", "DrawCards",
      "Explore", "GainLife", "GameLoss", "GameWin", "Learn", "LifeReduced",
      "LoseMana", "Mill", "Moved", "PayLife", "PlanarDiceResult", "Planeswalk",
      "ProduceMana", "Proliferate", "RemoveCounter", "RollDice", "RollPlanarDice",
      "Scry", "SetInMotion", "Tap", "Transform", "TurnFaceUp", "Untap",
    ];
    for (const r of required) expect(REPLACEMENT_TYPES).toContain(r);
  });

  it("parses Event$ line value case-insensitively", () => {
    expect(replacementTypeFromName("Moved")).toBe("Moved");
    expect(replacementTypeFromName("moved")).toBe("Moved");
    expect(replacementTypeFromName("DAMAGEDONE")).toBe("DamageDone");
    expect(replacementTypeFromName("NotAType")).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @mtg-forge-ts/core test replacement-type`
Expected: FAIL — module not found.

- [ ] **Step 3: Create the module**

Create `packages/core/src/abilities/replacement-type.ts`:

```ts
// SPDX-License-Identifier: GPL-3.0-or-later
// ReplacementType — the DSL-side identifier used in a card script's
//   R:Event$ <Kind> | ...
// line. Ported 1:1 from forge.game.replacement.ReplacementType. Each
// type maps to a matcher that narrows one or more MutationIntent kinds
// (see mutation-intent.ts in @mtg-forge-ts/game).

export const REPLACEMENT_TYPES = [
  "AddCounter",
  "AssembleContraption",
  "AssignDealDamage",
  "Attached",
  "BeginPhase",
  "BeginTurn",
  "Cascade",
  "Counter",
  "CopySpell",
  "CreateToken",
  "DamageDone",
  "DealtDamage",
  "DeclareBlocker",
  "Destroy",
  "Draw",
  "DrawCards",
  "Explore",
  "GainLife",
  "GameLoss",
  "GameWin",
  "Learn",
  "LifeReduced",
  "LoseMana",
  "Mill",
  "Moved",
  "PayLife",
  "PlanarDiceResult",
  "Planeswalk",
  "ProduceMana",
  "Proliferate",
  "RemoveCounter",
  "RollDice",
  "RollPlanarDice",
  "Scry",
  "SetInMotion",
  "Tap",
  "Transform",
  "TurnFaceUp",
  "Untap",
] as const;

export type ReplacementType = (typeof REPLACEMENT_TYPES)[number];

const BY_LOWER = new Map<string, ReplacementType>(
  REPLACEMENT_TYPES.map((t) => [t.toLowerCase(), t]),
);

export const isReplacementType = (value: string): value is ReplacementType => BY_LOWER.has(value.toLowerCase());

export const replacementTypeFromName = (name: string): ReplacementType | null =>
  BY_LOWER.get(name.toLowerCase()) ?? null;
```

- [ ] **Step 4: Export**

Edit `packages/core/src/abilities/index.ts`, add:

```ts
export * from "./replacement-type.js";
```

- [ ] **Step 5: Run test + gate**

Run: `pnpm --filter @mtg-forge-ts/core test replacement-type && pnpm typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/abilities/replacement-type.ts packages/core/src/abilities/replacement-type.test.ts packages/core/src/abilities/index.ts
git commit -s -m "feat(core): add ReplacementType enum (39 Forge kinds, B-C3)

Ported 1:1 from forge.game.replacement.ReplacementType. DSL parser
(SP3 M1) resolves R:Event\$ X lines to ReplacementType; runtime
matcher narrows MutationIntent kinds in Task 6."
```

---

### Task 6: Expand `MutationIntent` — 24 new typed variants

**Files:**
- Modify: `packages/game/src/replacements/mutation-intent.ts`
- Test: `packages/game/src/replacements/mutation-intent.test.ts` (create)

**Context:** Existing `INTENT_KINDS` covers 15 mutation shapes. Forge's `ReplacementType` covers 39 event kinds. The gap is ~24 new intent shapes for events that the engine is about to emit but which currently have no typed MutationIntent so replacements can't narrow on them.

This task lands the **typed interfaces** for the missing shapes. Not every new intent will be emitted from GameAction today; some are placeholders that SP3 Part B+'s effect handlers will start producing. The SBA/damage-routing fixes in SP2 Round 1 used defensive payload-reading on untyped intents; this task retires that defensive read for the typed subset.

New intent kinds (24, each with typed payload):
`scry, surveil, proliferate, cascade, produceMana, planeswalk, setInMotion, learn, explore, gameWin, gameLoss, declareBlocker, assembleContraption, assignDealDamage, attached, lifeReduced, loseMana, payLife, planarDiceResult, rollDice, rollPlanarDice, turnFaceUp, transform, beginPhase, beginTurn`.

(Total after this task: 15 existing + 24 new = 39, matching ReplacementType's 39.)

- [ ] **Step 1: Write the failing test**

Create `packages/game/src/replacements/mutation-intent.test.ts`:

```ts
// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, it, expect, expectTypeOf } from "vitest";
import type {
  KnownIntent,
  ScryIntent,
  SurveilIntent,
  ProliferateIntent,
  CascadeIntent,
  ProduceManaIntent,
  PlaneswalkIntent,
  SetInMotionIntent,
  LearnIntent,
  ExploreIntent,
  GameWinIntent,
  GameLossIntent,
  DeclareBlockerIntent,
  AssembleContraptionIntent,
  AssignDealDamageIntent,
  AttachedIntent,
  LifeReducedIntent,
  LoseManaIntent,
  PayLifeIntent,
  PlanarDiceResultIntent,
  RollDiceIntent,
  RollPlanarDiceIntent,
  TurnFaceUpIntent,
  TransformIntent,
  BeginPhaseIntent,
  BeginTurnIntent,
} from "./mutation-intent.js";
import { INTENT_KINDS } from "./mutation-intent.js";

describe("MutationIntent expansion", () => {
  it("exposes 39 intent kinds total", () => {
    expect(Object.keys(INTENT_KINDS)).toHaveLength(39);
  });

  it("narrows ScryIntent payload", () => {
    const i: ScryIntent = { kind: "scry", seat: 0, amount: 2 };
    expectTypeOf(i.amount).toBeNumber();
  });

  it("CascadeIntent carries sourceId + triggerCmc", () => {
    const i: CascadeIntent = { kind: "cascade", sourceId: 1, triggerCmc: 4, seat: 0 };
    expectTypeOf(i.triggerCmc).toBeNumber();
  });

  it("KnownIntent union discriminates all 39 kinds", () => {
    const fn = (i: KnownIntent): string => i.kind;
    // Compile-time exhaustive check below; runtime evidence:
    const sample: KnownIntent = { kind: "proliferate", seat: 0 };
    expect(fn(sample)).toBe("proliferate");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @mtg-forge-ts/game test mutation-intent`
Expected: FAIL — missing exports for the 24 new intent types and missing keys in INTENT_KINDS.

- [ ] **Step 3: Extend mutation-intent.ts**

Edit `packages/game/src/replacements/mutation-intent.ts`. Add new entries to `INTENT_KINDS`, new typed interfaces, and extend `KnownIntent` union:

```ts
export const INTENT_KINDS = {
  // Existing 15
  Damage: "damage",
  LifeChange: "lifeChange",
  DrawCards: "drawCards",
  MoveTo: "moveTo",
  AddCounter: "addCounter",
  RemoveCounter: "removeCounter",
  Tap: "tap",
  Untap: "untap",
  Destroy: "destroy",
  Exile: "exile",
  Sacrifice: "sacrifice",
  Mill: "mill",
  ControlChange: "controlChange",
  Attach: "attach",
  Unattach: "unattach",
  // New 24 (mapped 1:1 to ReplacementType gaps)
  Scry: "scry",
  Surveil: "surveil",
  Proliferate: "proliferate",
  Cascade: "cascade",
  ProduceMana: "produceMana",
  Planeswalk: "planeswalk",
  SetInMotion: "setInMotion",
  Learn: "learn",
  Explore: "explore",
  GameWin: "gameWin",
  GameLoss: "gameLoss",
  DeclareBlocker: "declareBlocker",
  AssembleContraption: "assembleContraption",
  AssignDealDamage: "assignDealDamage",
  Attached: "attached",
  LifeReduced: "lifeReduced",
  LoseMana: "loseMana",
  PayLife: "payLife",
  PlanarDiceResult: "planarDiceResult",
  RollDice: "rollDice",
  RollPlanarDice: "rollPlanarDice",
  TurnFaceUp: "turnFaceUp",
  Transform: "transform",
  BeginPhase: "beginPhase",
  BeginTurn: "beginTurn",
} as const;
```

Then append typed interfaces for each new kind (below the existing ones):

```ts
export interface ScryIntent {
  readonly kind: "scry";
  readonly seat: PlayerSeat;
  readonly amount: number;
}
export interface SurveilIntent {
  readonly kind: "surveil";
  readonly seat: PlayerSeat;
  readonly amount: number;
}
export interface ProliferateIntent {
  readonly kind: "proliferate";
  readonly seat: PlayerSeat;
}
export interface CascadeIntent {
  readonly kind: "cascade";
  readonly sourceId: EntityId;
  readonly seat: PlayerSeat;
  readonly triggerCmc: number;
}
export interface ProduceManaIntent {
  readonly kind: "produceMana";
  readonly seat: PlayerSeat;
  readonly sourceId: EntityId;
  readonly symbols: readonly string[];
}
export interface PlaneswalkIntent {
  readonly kind: "planeswalk";
  readonly seat: PlayerSeat;
}
export interface SetInMotionIntent {
  readonly kind: "setInMotion";
  readonly schemeId: EntityId;
  readonly seat: PlayerSeat;
}
export interface LearnIntent {
  readonly kind: "learn";
  readonly seat: PlayerSeat;
}
export interface ExploreIntent {
  readonly kind: "explore";
  readonly cardId: EntityId;
  readonly seat: PlayerSeat;
}
export interface GameWinIntent {
  readonly kind: "gameWin";
  readonly seat: PlayerSeat;
  readonly cause: string;
}
export interface GameLossIntent {
  readonly kind: "gameLoss";
  readonly seat: PlayerSeat;
  readonly cause: string;
}
export interface DeclareBlockerIntent {
  readonly kind: "declareBlocker";
  readonly blockerId: EntityId;
  readonly attackerIds: readonly EntityId[];
}
export interface AssembleContraptionIntent {
  readonly kind: "assembleContraption";
  readonly seat: PlayerSeat;
}
export interface AssignDealDamageIntent {
  readonly kind: "assignDealDamage";
  readonly sourceId: EntityId;
  readonly assignments: readonly { readonly targetId: EntityId; readonly amount: number }[];
}
export interface AttachedIntent {
  readonly kind: "attached";
  readonly sourceId: EntityId;
  readonly targetId: EntityId;
}
export interface LifeReducedIntent {
  readonly kind: "lifeReduced";
  readonly seat: PlayerSeat;
  readonly amount: number;
  readonly sourceId: EntityId | null;
}
export interface LoseManaIntent {
  readonly kind: "loseMana";
  readonly seat: PlayerSeat;
  readonly symbols: readonly string[];
}
export interface PayLifeIntent {
  readonly kind: "payLife";
  readonly seat: PlayerSeat;
  readonly amount: number;
}
export interface PlanarDiceResultIntent {
  readonly kind: "planarDiceResult";
  readonly seat: PlayerSeat;
  readonly face: "chaos" | "planeswalk" | "blank";
}
export interface RollDiceIntent {
  readonly kind: "rollDice";
  readonly seat: PlayerSeat;
  readonly sides: number;
  readonly count: number;
}
export interface RollPlanarDiceIntent {
  readonly kind: "rollPlanarDice";
  readonly seat: PlayerSeat;
}
export interface TurnFaceUpIntent {
  readonly kind: "turnFaceUp";
  readonly cardId: EntityId;
}
export interface TransformIntent {
  readonly kind: "transform";
  readonly cardId: EntityId;
}
export interface BeginPhaseIntent {
  readonly kind: "beginPhase";
  readonly seat: PlayerSeat;
  readonly phase: string;
}
export interface BeginTurnIntent {
  readonly kind: "beginTurn";
  readonly seat: PlayerSeat;
}
```

Then extend `KnownIntent`:

```ts
export type KnownIntent =
  | DamageIntent
  | LifeChangeIntent
  | DrawCardsIntent
  | MoveToIntent
  | AddCounterIntent
  | RemoveCounterIntent
  | TapIntent
  | UntapIntent
  | DestroyIntent
  | ExileIntent
  | SacrificeIntent
  | MillIntent
  | ControlChangeIntent
  | AttachIntent
  | UnattachIntent
  | ScryIntent
  | SurveilIntent
  | ProliferateIntent
  | CascadeIntent
  | ProduceManaIntent
  | PlaneswalkIntent
  | SetInMotionIntent
  | LearnIntent
  | ExploreIntent
  | GameWinIntent
  | GameLossIntent
  | DeclareBlockerIntent
  | AssembleContraptionIntent
  | AssignDealDamageIntent
  | AttachedIntent
  | LifeReducedIntent
  | LoseManaIntent
  | PayLifeIntent
  | PlanarDiceResultIntent
  | RollDiceIntent
  | RollPlanarDiceIntent
  | TurnFaceUpIntent
  | TransformIntent
  | BeginPhaseIntent
  | BeginTurnIntent;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @mtg-forge-ts/game test mutation-intent`
Expected: PASS.

- [ ] **Step 5: Full gate**

Run: `pnpm typecheck && pnpm test`
Expected: all existing 1844+ tests still pass (additive).

- [ ] **Step 6: Commit**

```bash
git add packages/game/src/replacements/mutation-intent.ts packages/game/src/replacements/mutation-intent.test.ts
git commit -s -m "feat(game): expand MutationIntent to 39 typed kinds (B-C3)

Added 24 new intent shapes matching Forge ReplacementType: scry,
surveil, proliferate, cascade, produceMana, planeswalk, setInMotion,
learn, explore, gameWin, gameLoss, declareBlocker,
assembleContraption, assignDealDamage, attached, lifeReduced,
loseMana, payLife, planarDiceResult, rollDice, rollPlanarDice,
turnFaceUp, transform, beginPhase, beginTurn. Additive; existing
GameAction paths unchanged. SP3 effect handlers emit the new shapes."
```

---

### Task 7: Minimal `RestrictionKind` expansion (action-filter subset only)

**Files:**
- Modify: `packages/game/src/statics/cant-must-may.ts`
- Test: `packages/game/src/statics/cant-must-may.test.ts` (extend)

**Context:** Audit finding B-C5 called for expanding `RestrictionKind` to 22+ entries. Architectural refinement: most of Forge's `Cant*` `StaticAbilityMode` values are **not** action filters — they're replacement-generating or rule-changing statics (e.g. `CantDraw` intercepts a `drawCards` intent and returns null; `CantSacrifice` blocks a sacrifice mutation; `CantBeCopied` intercepts copy replacements). The cleanest structure is:
- **`StaticAbilityMode`** (Task 8) — full 82-entry Forge taxonomy.
- **`RestrictionKind`** — small action-filter subset consulted by the decision validator (priority orchestrator, combat declaration). Only kinds that filter **player choices**, not mutations.

Minimal expansion: add **mustTarget** + **cantPhaseIn** + **cantPhaseOut**. Leave `cantDraw`, `cantSacrifice`, etc. to route through replacement-generating statics (Task 9 wires StaticAbilityMode into the statics registry so mode-based dispatch covers them).

- [ ] **Step 1: Write the failing test**

Add to `packages/game/src/statics/cant-must-may.test.ts` (create if missing):

```ts
// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, it, expect, expectTypeOf } from "vitest";
import type { RestrictionKind } from "./cant-must-may.js";

describe("RestrictionKind expansion", () => {
  it("covers the action-filter subset (11 kinds)", () => {
    const kinds: RestrictionKind[] = [
      "cantCast",
      "cantActivate",
      "cantAttack",
      "mustAttack",
      "cantBlock",
      "mustBlock",
      "cantTarget",
      "cantUntap",
      "mustTarget",
      "cantPhaseIn",
      "cantPhaseOut",
    ];
    expect(kinds).toHaveLength(11);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @mtg-forge-ts/game test cant-must-may`
Expected: FAIL — types `mustTarget`, `cantPhaseIn`, `cantPhaseOut` not in union.

- [ ] **Step 3: Extend the union**

Edit `packages/game/src/statics/cant-must-may.ts:18-26`:

```ts
export type RestrictionKind =
  | "cantCast"
  | "cantActivate"
  | "cantAttack"
  | "mustAttack"
  | "cantBlock"
  | "mustBlock"
  | "cantTarget"
  | "cantUntap"
  | "mustTarget"
  | "cantPhaseIn"
  | "cantPhaseOut";
```

Update the file's header comment to note: "Restrictions are **action filters** for the decision validator. Mutation-interception (CantDraw, CantSacrifice, CantBeCopied, etc.) is a replacement-generating static, dispatched via `StaticAbilityMode` (Task 8); they do NOT live in RestrictionKind."

- [ ] **Step 4: Run test + gate**

Run: `pnpm --filter @mtg-forge-ts/game test cant-must-may && pnpm typecheck && pnpm test`
Expected: PASS; 1844+ existing tests unchanged.

- [ ] **Step 5: Commit**

```bash
git add packages/game/src/statics/cant-must-may.ts packages/game/src/statics/cant-must-may.test.ts
git commit -s -m "feat(game): add mustTarget, cantPhaseIn, cantPhaseOut to RestrictionKind (B-C5)

Architectural note: RestrictionKind is the action-filter subset
consulted by the decision validator. Forge's full Cant* taxonomy lives
in StaticAbilityMode (Task 8); mutation-interception kinds (CantDraw,
CantSacrifice, CantBeCopied, etc.) are replacement-generating
statics, not action filters."
```

---

### Task 8: `StaticAbilityMode` enum (82 entries) + mode→category mapping

**Files:**
- Create: `packages/core/src/abilities/static-ability-mode.ts`
- Modify: `packages/core/src/abilities/static-ability.ts` (add `mode` field)
- Modify: `packages/core/src/abilities/index.ts` (export)
- Test: `packages/core/src/abilities/static-ability-mode.test.ts`

**Forge reference:** `forge-game/src/main/java/forge/game/staticability/StaticAbilityMode.java` — 82 enum values. Each maps to one of the 8 `StaticAbilityCategory` buckets from SP2:

| StaticAbilityMode | Category |
|---|---|
| Continuous | continuous |
| CantAttackUnless, CantBlockUnless, OptionalAttackCost, OptionalCost | cantMustMay |
| AlternativeCost | alternativeCost |
| CantBeCast, CantBeActivated, CantPlayLand | cantMustMay |
| DisableTriggers, Panharmonicon | ruleChanging |
| MustTarget, CantTarget | cantMustMay |
| CantAttack, CanAttackDefender, CantBlock, CantBlockBy, CanAttackIfHaste, CanBlockIfReach, MinMaxBlocker, BlockTapped, AttackVigilance | cantMustMay |
| MustAttack, PlayerMustAttack, MustBlock | cantMustMay |
| AssignCombatDamageAsUnblocked, CombatDamageToughness, ColorlessDamageSource, NoCleanupDamage | ruleChanging |
| BlockRestrict | cantMustMay |
| CantGainLife, CantLoseLife, CantChangeLife, CantPayLife | replacementGenerating |
| RaiseCost, ReduceCost, SetCost | costModification |
| IgnoreHexproof, IgnoreShroud | ruleChanging |
| AttackRestrict | cantMustMay |
| AssignNoCombatDamage | ruleChanging |
| CanAdapt, CanExhaust | ruleChanging |
| CantBeCopied, CantBeSuspected, CantBecomeMonarch | replacementGenerating |
| CantAttach, CantCrew | replacementGenerating |
| CantDraw, CantDiscard, CantExile, CantPhaseIn, CantPhaseOut, CantPreventDamage, CantPutCounter, CantRegenerate, CantSacrifice, CantTransform, CantVenture | replacementGenerating |
| CantChangeDayTime | ruleChanging |
| ActivateAbilityAsIfHaste, CastWithFlash | ruleChanging |
| IgnoreLandwalk, IgnoreLegendRule | ruleChanging |
| MaxCounter | replacementGenerating |
| InfectDamage, WitherDamage | ruleChanging |
| FlipCoinMod | ruleChanging |
| PlotZone | ruleChanging |
| NumLoyaltyAct | ruleChanging |
| Devotion, GainLifeRadiation | ruleChanging |
| SurveilNum | ruleChanging |
| TapPowerValue | continuous |
| UnspentMana, ManaBurn | ruleChanging |
| ManaConvert | ruleChanging |
| UntapOtherPlayer | ruleChanging |
| TurnReversed, PhaseReversed | ruleChanging |
| AttackRequirement | cantMustMay |
| CountersRemain | replacementGenerating |

- [ ] **Step 1: Write the failing test**

Create `packages/core/src/abilities/static-ability-mode.test.ts`:

```ts
// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, it, expect } from "vitest";
import {
  STATIC_ABILITY_MODES,
  staticAbilityModeCategory,
  staticAbilityModeFromName,
  type StaticAbilityMode,
} from "./static-ability-mode.js";
import type { StaticAbilityCategory } from "./static-ability.js";

describe("StaticAbilityMode", () => {
  it("enumerates 82 Forge modes", () => {
    expect(STATIC_ABILITY_MODES).toHaveLength(82);
  });

  it("every mode maps to exactly one StaticAbilityCategory", () => {
    for (const mode of STATIC_ABILITY_MODES) {
      const cat: StaticAbilityCategory = staticAbilityModeCategory(mode);
      expect(cat).toBeTruthy();
    }
  });

  it("Continuous maps to continuous category", () => {
    expect(staticAbilityModeCategory("Continuous")).toBe("continuous");
  });

  it("CantDraw maps to replacementGenerating (not cantMustMay)", () => {
    expect(staticAbilityModeCategory("CantDraw")).toBe("replacementGenerating");
  });

  it("CantAttack maps to cantMustMay (action filter)", () => {
    expect(staticAbilityModeCategory("CantAttack")).toBe("cantMustMay");
  });

  it("RaiseCost/ReduceCost/SetCost map to costModification", () => {
    expect(staticAbilityModeCategory("RaiseCost")).toBe("costModification");
    expect(staticAbilityModeCategory("ReduceCost")).toBe("costModification");
    expect(staticAbilityModeCategory("SetCost")).toBe("costModification");
  });

  it("AlternativeCost maps to alternativeCost", () => {
    expect(staticAbilityModeCategory("AlternativeCost")).toBe("alternativeCost");
  });

  it("parses Mode$ line value case-insensitively", () => {
    expect(staticAbilityModeFromName("continuous")).toBe("Continuous");
    expect(staticAbilityModeFromName("CANTDRAW")).toBe("CantDraw");
    expect(staticAbilityModeFromName("NotARealMode")).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @mtg-forge-ts/core test static-ability-mode`
Expected: FAIL — module not found.

- [ ] **Step 3: Create the module**

Create `packages/core/src/abilities/static-ability-mode.ts`:

```ts
// SPDX-License-Identifier: GPL-3.0-or-later
// StaticAbilityMode — DSL-side identifier used in a card script's
//   S:Mode$ <Mode> | ...
// line. Ported 1:1 from forge.game.staticability.StaticAbilityMode (82
// entries). Each mode maps deterministically to one of the 8
// StaticAbilityCategory buckets from SP2 (see modeCategory below).

import type { StaticAbilityCategory } from "./static-ability.js";

export const STATIC_ABILITY_MODES = [
  "Continuous",
  "CantAttackUnless",
  "CantBlockUnless",
  "OptionalAttackCost",
  "OptionalCost",
  "AlternativeCost",
  "CantBeCast",
  "CantBeActivated",
  "CantPlayLand",
  "DisableTriggers",
  "Panharmonicon",
  "MustTarget",
  "CantTarget",
  "CantAttack",
  "CanAttackDefender",
  "CantBlock",
  "CantBlockBy",
  "CanAttackIfHaste",
  "CanBlockIfReach",
  "MinMaxBlocker",
  "BlockTapped",
  "AttackVigilance",
  "MustAttack",
  "PlayerMustAttack",
  "MustBlock",
  "AssignCombatDamageAsUnblocked",
  "CombatDamageToughness",
  "ColorlessDamageSource",
  "NoCleanupDamage",
  "BlockRestrict",
  "CantGainLife",
  "CantLoseLife",
  "CantChangeLife",
  "CantPayLife",
  "RaiseCost",
  "ReduceCost",
  "SetCost",
  "IgnoreHexproof",
  "IgnoreShroud",
  "AttackRestrict",
  "AssignNoCombatDamage",
  "CanAdapt",
  "CanExhaust",
  "CantBeCopied",
  "CantBeSuspected",
  "CantBecomeMonarch",
  "CantAttach",
  "CantCrew",
  "CantDraw",
  "CantDiscard",
  "CantExile",
  "CantPhaseIn",
  "CantPhaseOut",
  "CantPreventDamage",
  "CantPutCounter",
  "CantRegenerate",
  "CantSacrifice",
  "CantTransform",
  "CantVenture",
  "CantChangeDayTime",
  "ActivateAbilityAsIfHaste",
  "CastWithFlash",
  "IgnoreLandwalk",
  "IgnoreLegendRule",
  "MaxCounter",
  "InfectDamage",
  "WitherDamage",
  "FlipCoinMod",
  "PlotZone",
  "NumLoyaltyAct",
  "Devotion",
  "GainLifeRadiation",
  "SurveilNum",
  "TapPowerValue",
  "UnspentMana",
  "ManaBurn",
  "ManaConvert",
  "UntapOtherPlayer",
  "TurnReversed",
  "PhaseReversed",
  "AttackRequirement",
  "CountersRemain",
] as const;

export type StaticAbilityMode = (typeof STATIC_ABILITY_MODES)[number];

const MODE_TO_CATEGORY: Record<StaticAbilityMode, StaticAbilityCategory> = {
  Continuous: "continuous",
  CantAttackUnless: "cantMustMay",
  CantBlockUnless: "cantMustMay",
  OptionalAttackCost: "cantMustMay",
  OptionalCost: "cantMustMay",
  AlternativeCost: "alternativeCost",
  CantBeCast: "cantMustMay",
  CantBeActivated: "cantMustMay",
  CantPlayLand: "cantMustMay",
  DisableTriggers: "ruleChanging",
  Panharmonicon: "ruleChanging",
  MustTarget: "cantMustMay",
  CantTarget: "cantMustMay",
  CantAttack: "cantMustMay",
  CanAttackDefender: "cantMustMay",
  CantBlock: "cantMustMay",
  CantBlockBy: "cantMustMay",
  CanAttackIfHaste: "cantMustMay",
  CanBlockIfReach: "cantMustMay",
  MinMaxBlocker: "cantMustMay",
  BlockTapped: "cantMustMay",
  AttackVigilance: "cantMustMay",
  MustAttack: "cantMustMay",
  PlayerMustAttack: "cantMustMay",
  MustBlock: "cantMustMay",
  AssignCombatDamageAsUnblocked: "ruleChanging",
  CombatDamageToughness: "ruleChanging",
  ColorlessDamageSource: "ruleChanging",
  NoCleanupDamage: "ruleChanging",
  BlockRestrict: "cantMustMay",
  CantGainLife: "replacementGenerating",
  CantLoseLife: "replacementGenerating",
  CantChangeLife: "replacementGenerating",
  CantPayLife: "replacementGenerating",
  RaiseCost: "costModification",
  ReduceCost: "costModification",
  SetCost: "costModification",
  IgnoreHexproof: "ruleChanging",
  IgnoreShroud: "ruleChanging",
  AttackRestrict: "cantMustMay",
  AssignNoCombatDamage: "ruleChanging",
  CanAdapt: "ruleChanging",
  CanExhaust: "ruleChanging",
  CantBeCopied: "replacementGenerating",
  CantBeSuspected: "replacementGenerating",
  CantBecomeMonarch: "replacementGenerating",
  CantAttach: "replacementGenerating",
  CantCrew: "replacementGenerating",
  CantDraw: "replacementGenerating",
  CantDiscard: "replacementGenerating",
  CantExile: "replacementGenerating",
  CantPhaseIn: "replacementGenerating",
  CantPhaseOut: "replacementGenerating",
  CantPreventDamage: "replacementGenerating",
  CantPutCounter: "replacementGenerating",
  CantRegenerate: "replacementGenerating",
  CantSacrifice: "replacementGenerating",
  CantTransform: "replacementGenerating",
  CantVenture: "replacementGenerating",
  CantChangeDayTime: "ruleChanging",
  ActivateAbilityAsIfHaste: "ruleChanging",
  CastWithFlash: "ruleChanging",
  IgnoreLandwalk: "ruleChanging",
  IgnoreLegendRule: "ruleChanging",
  MaxCounter: "replacementGenerating",
  InfectDamage: "ruleChanging",
  WitherDamage: "ruleChanging",
  FlipCoinMod: "ruleChanging",
  PlotZone: "ruleChanging",
  NumLoyaltyAct: "ruleChanging",
  Devotion: "ruleChanging",
  GainLifeRadiation: "ruleChanging",
  SurveilNum: "ruleChanging",
  TapPowerValue: "continuous",
  UnspentMana: "ruleChanging",
  ManaBurn: "ruleChanging",
  ManaConvert: "ruleChanging",
  UntapOtherPlayer: "ruleChanging",
  TurnReversed: "ruleChanging",
  PhaseReversed: "ruleChanging",
  AttackRequirement: "cantMustMay",
  CountersRemain: "replacementGenerating",
};

export const staticAbilityModeCategory = (mode: StaticAbilityMode): StaticAbilityCategory =>
  MODE_TO_CATEGORY[mode];

const BY_LOWER = new Map<string, StaticAbilityMode>(
  STATIC_ABILITY_MODES.map((m) => [m.toLowerCase(), m]),
);

export const staticAbilityModeFromName = (name: string): StaticAbilityMode | null =>
  BY_LOWER.get(name.toLowerCase()) ?? null;

export const isStaticAbilityMode = (value: string): value is StaticAbilityMode =>
  BY_LOWER.has(value.toLowerCase());
```

- [ ] **Step 4: Add `mode` to StaticAbility**

Edit `packages/core/src/abilities/static-ability.ts`:

```ts
// SPDX-License-Identifier: GPL-3.0-or-later
// CR 604 — static ability shape. SP2 Tasks 25-28 implemented the registry;
// SP3 Task 8 adds the StaticAbilityMode companion (82 Forge modes, each
// mapped to exactly one StaticAbilityCategory).
import type { AbilityBase } from "./active-ability.js";
import type { StaticAbilityMode } from "./static-ability-mode.js";

export type StaticAbilityCategory =
  | "continuous"
  | "costModification"
  | "cantMustMay"
  | "replacementGenerating"
  | "preventDamage"
  | "ruleChanging"
  | "abilityGranting"
  | "alternativeCost";

export interface StaticAbility extends AbilityBase {
  readonly kind: "static";
  readonly category: StaticAbilityCategory;
  readonly mode: StaticAbilityMode;
  describe(): unknown;
}
```

- [ ] **Step 5: Migrate existing StaticAbility instantiations**

Grep for `kind: "static"` in the game package:

```bash
grep -rn 'kind: "static"' packages/game/src --include="*.ts" | grep -v "\.test\."
```

At each site, add `mode: "Continuous"` (the safe default for SP2-era layer contributors) to the literal. For sites explicitly tied to cost modification, cantMustMay, etc., use the matching mode:
- Layer contributors / continuous effects → `mode: "Continuous"`
- Cost modification → `mode: "RaiseCost"`, `"ReduceCost"`, or `"SetCost"` (pick closest)
- Rule overrides → `mode: "Panharmonicon"` (generic ruleChanging marker; refine in SP3 Part B)
- CantMustMay → match the RestrictionKind (e.g. `cantAttack` → `CantAttack`, `mustAttack` → `MustAttack`, `cantBlock` → `CantBlock`, `cantTarget` → `CantTarget`, `cantUntap` → `Continuous` if it's a layer effect, or a custom mode if it's a literal restriction — inspect each site)

- [ ] **Step 6: Export**

Edit `packages/core/src/abilities/index.ts`:

```ts
export * from "./static-ability-mode.js";
```

- [ ] **Step 7: Run test + full gate**

Run: `pnpm --filter @mtg-forge-ts/core test static-ability-mode && pnpm typecheck && pnpm test`
Expected: PASS; all 1844+ existing tests unchanged.

- [ ] **Step 8: Commit**

```bash
git add packages/core/src/abilities/static-ability-mode.ts packages/core/src/abilities/static-ability-mode.test.ts packages/core/src/abilities/static-ability.ts packages/core/src/abilities/index.ts packages/game/src
git commit -s -m "feat(core): add StaticAbilityMode enum (82 Forge modes, B-C4)

Each mode maps to exactly one of the 8 StaticAbilityCategory buckets
from SP2. Mode→category is a total function. Existing StaticAbility
sites carry mode='Continuous' by default; SP3 card ports set the
precise mode per R:/S:/A: line semantics."
```

---

### Task 9: Wire `StaticAbilityMode` into `static-effect-registry` + `replacement-orderer` layer partition

**Files:**
- Modify: `packages/game/src/statics/static-effect-registry.ts`
- Modify: `packages/game/src/replacements/replacement-orderer.ts`
- Modify: `packages/game/src/statics/cant-must-may.ts` (add mode-aware filter)
- Test: `packages/game/src/statics/static-effect-registry.test.ts` (extend)
- Test: `packages/game/src/replacements/replacement-orderer.test.ts` (extend for layer partition)

**Context:** Two wire-ups:
1. `static-effect-registry` gains a `byMode(mode: StaticAbilityMode)` query that returns statics matching a specific mode (complements the existing `byCategory`).
2. `replacement-orderer.orderReplacements` partitions `applicable` into five buckets by `ReplacementLayer`, asks the orderer to order within each non-empty bucket, and concatenates in bucket-rank order.

- [ ] **Step 1: Write the failing test for `byMode`**

Add to `packages/game/src/statics/static-effect-registry.test.ts`:

```ts
import { staticAbilityModeCategory, type StaticAbilityMode } from "@mtg-forge-ts/core";

// ... existing tests ...

describe("byMode query", () => {
  it("returns only statics matching the given mode", () => {
    const registry = new StaticEffectRegistry();
    const raiseCost: StaticAbility = { /* ... kind: 'static', mode: 'RaiseCost', category: 'costModification', ... */ };
    const reduceCost: StaticAbility = { /* ... mode: 'ReduceCost' ... */ };
    registry.register(raiseCost);
    registry.register(reduceCost);
    expect(registry.byMode("RaiseCost")).toHaveLength(1);
    expect(registry.byMode("ReduceCost")).toHaveLength(1);
    expect(registry.byMode("Continuous")).toHaveLength(0);
  });

  it("byMode and byCategory are consistent: byMode(m) ⊆ byCategory(category(m))", () => {
    const registry = new StaticEffectRegistry();
    // register a few; verify subset invariant
    // ... implementation ...
  });
});
```

- [ ] **Step 2: Add `byMode` to static-effect-registry**

Edit `packages/game/src/statics/static-effect-registry.ts` (add a method alongside `byCategory`):

```ts
byMode(mode: StaticAbilityMode): readonly StaticAbility[] {
  const out: StaticAbility[] = [];
  for (const [_, s] of this.entries) {
    if (s.mode === mode) out.push(s);
  }
  return out;
}
```

- [ ] **Step 3: Write the failing test for layer partition**

Add to `packages/game/src/replacements/replacement-orderer.test.ts`:

```ts
// ... existing tests ...

describe("CR 616 layer partition", () => {
  it("applies cantHappen replacements before other replacements", () => {
    // Construct 3 replacements: cantHappen, control, other
    // Verify order always: cantHappen → control → other (regardless of
    // registration order / player choice inside buckets).
  });

  it("within-bucket order is decided by the affected-player tiebreak", () => {
    // Two 'other'-layer replacements; player-driven order choice applies.
  });
});
```

- [ ] **Step 4: Implement bucket partition**

Edit `packages/game/src/replacements/replacement-orderer.ts`. The orderer now:
1. Partitions `applicable` into 5 buckets by `r.layer`.
2. For each non-empty bucket (in REPLACEMENT_LAYERS order), runs the existing single-bucket orderer (yielding `orderReplacements` decision if bucket.length > 1).
3. Concatenates bucket outputs.

Sketch:

```ts
import { REPLACEMENT_LAYERS, replacementLayerOrder, type ReplacementLayer } from "@mtg-forge-ts/core";

export function* orderReplacements(
  applicable: readonly ReplacementAbility[],
  intent: MutationIntent,
  game: Game,
): Generator<EngineYield, readonly EntityId[], unknown> {
  if (applicable.length === 0) return [];

  // Partition by layer
  const buckets = new Map<ReplacementLayer, ReplacementAbility[]>();
  for (const layer of REPLACEMENT_LAYERS) buckets.set(layer, []);
  for (const r of applicable) buckets.get(r.layer)!.push(r);

  const result: EntityId[] = [];
  for (const layer of REPLACEMENT_LAYERS) {
    const bucket = buckets.get(layer)!;
    if (bucket.length === 0) continue;
    if (bucket.length === 1) {
      result.push(bucket[0]!.id);
      continue;
    }
    // Multi-replacement within-bucket tiebreak (same as pre-layer logic)
    const orderer = chooseOrderer(intent, game);
    const response = (yield {
      kind: "decision",
      request: {
        kind: "orderReplacements",
        playerSeat: orderer,
        replacementIds: bucket.map((r) => r.id),
      },
    }) as { order: readonly EntityId[] } | undefined;
    if (!response || !Array.isArray(response.order) || !isValidOrder(response.order, bucket)) {
      throw new Error(
        `orderReplacements: invalid response for ${layer} bucket: ${JSON.stringify(response)}`,
      );
    }
    result.push(...response.order);
  }
  return result;
}
```

- [ ] **Step 5: Run tests + gate**

Run: `pnpm --filter @mtg-forge-ts/game test replacement-orderer static-effect-registry && pnpm typecheck && pnpm test`
Expected: all pass. The partition is a superset of the pre-existing single-bucket behavior when all `applicable` replacements are `layer: "other"` — which is the default for every SP2-era replacement — so no SP2 test regresses.

- [ ] **Step 6: Commit**

```bash
git add packages/game/src/statics/static-effect-registry.ts packages/game/src/statics/static-effect-registry.test.ts packages/game/src/replacements/replacement-orderer.ts packages/game/src/replacements/replacement-orderer.test.ts
git commit -s -m "feat(game): wire ReplacementLayer partition + StaticAbilityMode dispatch

replacement-orderer now partitions by CR 616.1 layer before
within-bucket tiebreak. static-effect-registry gains byMode query
alongside byCategory. Mode-aware dispatch unblocks SP3 replacement/
rule-changing statics that need precise mode discrimination."
```

---

### M0 gate — finalize Forge-roster expansion

- [ ] **Run the full gate**

```bash
pnpm typecheck && pnpm test && pnpm build && pnpm lint && pnpm lint:determinism
```

All gates green. Test count: 1844 + 10+ new tests.

- [ ] **Update SP3 plan notes** (no commit yet — leave checkpoint markers for the reviewer to read)

Confirm in the plan's "Checkpoint log" (added as a trailing file section when M0 completes):

- B-C1 MulliganRule expanded ✓
- B-C2 ReplacementLayer enum added ✓
- B-C3 ReplacementType + MutationIntent expanded ✓
- B-C4 StaticAbilityMode enum added ✓
- B-C5 RestrictionKind minimally expanded (action-filter subset) ✓
- B-C7 KeywordId added ✓

---

## Milestone M1 — DSL parser foundation

Creates `@mtg-forge-ts/cards` and builds the lexer + per-prefix line parsers + AST assembler. Output: a `parseCard(source: string, file: string): ParseResult<CardDefinition>` function with source-location errors.

Forge parser reference:
- `forge-core/src/main/java/forge/card/CardRules.java` — type line, mana cost, P/T, loyalty parsing.
- `forge-core/src/main/java/forge/card/CardRulesReader.java` — prefix dispatch.
- `forge-game/src/main/java/forge/game/ability/AbilityFactory.java` + `AbilityFactoryUtil.java` — ability-line parsing (SP$/AB$/DB$).
- `forge-game/src/main/java/forge/game/trigger/TriggerHandler.java#parseTrigger` — trigger-line parsing.
- `forge-game/src/main/java/forge/game/replacement/ReplacementHandler.java#parseReplacement` — replacement-line parsing.
- `forge-game/src/main/java/forge/game/staticability/StaticAbility.java` — static-line parsing.

### Task 10: Bootstrap `@mtg-forge-ts/cards` workspace

**Files:**
- Create: `packages/cards/package.json`
- Create: `packages/cards/tsconfig.json`
- Create: `packages/cards/vitest.config.ts`
- Create: `packages/cards/tsup.config.ts`
- Create: `packages/cards/src/index.ts`
- Create: `packages/cards/src/index.test.ts`
- Create: `packages/cards/LICENSE` (copy from packages/core/LICENSE)

- [ ] **Step 1: Write the smoke test**

Create `packages/cards/src/index.test.ts`:

```ts
// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, it, expect } from "vitest";
import { CARDS_VERSION } from "./index.js";

describe("@mtg-forge-ts/cards", () => {
  it("exposes a version constant", () => {
    expect(CARDS_VERSION).toBe("0.0.0");
  });
});
```

- [ ] **Step 2: Create `src/index.ts`**

```ts
// SPDX-License-Identifier: GPL-3.0-or-later
export const CARDS_VERSION = "0.0.0";
```

- [ ] **Step 3: Create `package.json`** (mirror `packages/core/package.json` structure):

```json
{
  "name": "@mtg-forge-ts/cards",
  "version": "0.0.0",
  "description": "Forge card DSL parser and structural validator for mtg-forge-ts.",
  "license": "GPL-3.0-or-later",
  "repository": {
    "type": "git",
    "url": "git+https://github.com/Baldugar/mtg-forge-ts.git",
    "directory": "packages/cards"
  },
  "homepage": "https://github.com/Baldugar/mtg-forge-ts#readme",
  "bugs": {
    "url": "https://github.com/Baldugar/mtg-forge-ts/issues"
  },
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
  "sideEffects": false,
  "scripts": {
    "build": "tsup",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "test:unit": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "@mtg-forge-ts/core": "workspace:*"
  },
  "devDependencies": {
    "fast-check": "^3.22.0",
    "tsup": "^8.3.0",
    "typescript": "^5.6.0",
    "vitest": "^2.1.0"
  }
}
```

- [ ] **Step 4: Create `tsconfig.json`**

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

- [ ] **Step 5: Create `vitest.config.ts`**

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

- [ ] **Step 6: Create `tsup.config.ts`**

```ts
import { defineConfig } from "tsup";
export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm", "cjs"],
  outExtension({ format }) {
    return { js: format === "esm" ? ".mjs" : ".cjs" };
  },
  dts: true,
  clean: true,
  sourcemap: true,
  target: "node20",
});
```

- [ ] **Step 7: Install + run**

```bash
pnpm install
pnpm --filter @mtg-forge-ts/cards test
pnpm --filter @mtg-forge-ts/cards build
pnpm --filter @mtg-forge-ts/cards typecheck
```

Expected: smoke test passes, build produces `dist/index.mjs`, typecheck clean.

- [ ] **Step 8: Commit**

```bash
git add packages/cards pnpm-lock.yaml
git commit -s -m "feat(cards): bootstrap @mtg-forge-ts/cards workspace

Parser package scaffold mirroring core/game conventions: tsup esm+cjs
build, vitest, biome, strict TS flags. Depends on @mtg-forge-ts/core
for DSL AST types (dsl/ast.ts). No parser logic yet — that's Tasks
11–26."
```

---

### Task 11: Lexer — `LexedLine` with escape/pipe/dollar tokenization

**Files:**
- Create: `packages/cards/src/parser/lexer.ts`
- Create: `packages/cards/src/parser/lexer.test.ts`

**Forge reference:** Forge splits lines by `|` and each segment by `$`, with `\|` / `\$` escape sequences (see `CardRulesReader.parseLine`). Preserves whitespace inside values; trims ends.

- [ ] **Step 1: Write the failing test**

Create `packages/cards/src/parser/lexer.test.ts`:

```ts
// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, it, expect } from "vitest";
import { lex, type LexedLine } from "./lexer.js";

describe("lex", () => {
  it("tokenizes a Name: line with no pipes", () => {
    const out = lex("Name:Lightning Bolt\n");
    expect(out).toEqual([
      { lineNumber: 1, prefix: "Name", content: "Lightning Bolt", tokens: [] },
    ] satisfies LexedLine[]);
  });

  it("tokenizes a single ability line with $-keyed params", () => {
    const out = lex("A:SP$ DealDamage | Cost$ R | NumDmg$ 3 | ValidTgts$ Any\n");
    expect(out[0]?.prefix).toBe("A");
    expect(out[0]?.tokens).toEqual([
      new Map([["SP", "DealDamage"]]),
      new Map([["Cost", "R"]]),
      new Map([["NumDmg", "3"]]),
      new Map([["ValidTgts", "Any"]]),
    ]);
  });

  it("honors \\| escape inside values", () => {
    const out = lex("Text:foo\\|bar\n");
    expect(out[0]?.content).toBe("foo|bar");
  });

  it("honors \\$ escape inside values", () => {
    const out = lex("SVar:X:Count\\$PaidX\n");
    expect(out[0]?.content).toBe("X:Count$PaidX");
  });

  it("skips blank lines and # comment lines", () => {
    const out = lex("# comment\nName:Bolt\n\n");
    expect(out).toHaveLength(1);
    expect(out[0]?.prefix).toBe("Name");
  });

  it("preserves 1-indexed lineNumber across skipped lines", () => {
    const out = lex("# c1\nName:Bolt\n# c3\nManaCost:R\n");
    expect(out[0]?.lineNumber).toBe(2);
    expect(out[1]?.lineNumber).toBe(4);
  });

  it("trims whitespace around tokens but preserves inner whitespace", () => {
    const out = lex("A:SP$ DealDamage | ValidTgts$ Creature.YouCtrl\n");
    expect(out[0]?.tokens[0]).toEqual(new Map([["SP", "DealDamage"]]));
    expect(out[0]?.tokens[1]).toEqual(new Map([["ValidTgts", "Creature.YouCtrl"]]));
  });

  it("rejects lines without a prefix colon", () => {
    expect(() => lex("NoColonHere\n")).toThrow(/line 1: missing prefix colon/);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @mtg-forge-ts/cards test lexer`
Expected: module not found.

- [ ] **Step 3: Implement the lexer**

Create `packages/cards/src/parser/lexer.ts`:

```ts
// SPDX-License-Identifier: GPL-3.0-or-later
// Lexer — raw card .txt → array of LexedLine. Stage 1 of the five-stage
// parser pipeline (lexer → line parsers → AST assembler → resolver →
// CardDefinition). Forge-compatible: \| and \$ escape sequences, #
// comments skipped (but 1-indexed lineNumber preserved), whitespace
// trimmed at token boundaries.

export interface LexedLine {
  readonly lineNumber: number;
  readonly prefix: string;
  readonly content: string;
  readonly tokens: readonly ReadonlyMap<string, string>[];
}

const PIPE_ESCAPE = "\x01";
const DOLLAR_ESCAPE = "\x02";

export const lex = (source: string): readonly LexedLine[] => {
  const lines = source.split(/\r?\n/);
  const out: LexedLine[] = [];
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i] ?? "";
    const lineNumber = i + 1;
    const trimmed = raw.trim();
    if (trimmed === "" || trimmed.startsWith("#")) continue;
    const colonIdx = raw.indexOf(":");
    if (colonIdx < 0) {
      throw new Error(`lex: line ${lineNumber}: missing prefix colon`);
    }
    const prefix = raw.slice(0, colonIdx).trim();
    const rest = raw.slice(colonIdx + 1);
    const escaped = rest.replaceAll("\\|", PIPE_ESCAPE).replaceAll("\\$", DOLLAR_ESCAPE);
    const segments = escaped.split("|");
    const tokens: ReadonlyMap<string, string>[] = [];
    for (let s = 1; s < segments.length; s++) {
      const seg = segments[s] ?? "";
      const dollarIdx = seg.indexOf("$");
      if (dollarIdx < 0) {
        // Tokens without $ are positional flags (rare in Forge scripts —
        // treated as key-only, empty value).
        const key = seg.replaceAll(PIPE_ESCAPE, "|").replaceAll(DOLLAR_ESCAPE, "$").trim();
        if (key !== "") tokens.push(new Map([[key, ""]]));
        continue;
      }
      const key = seg.slice(0, dollarIdx).trim();
      const value = seg
        .slice(dollarIdx + 1)
        .replaceAll(PIPE_ESCAPE, "|")
        .replaceAll(DOLLAR_ESCAPE, "$")
        .trim();
      tokens.push(new Map([[key, value]]));
    }
    // Strip segment-0 (the free-form head) from content — content holds
    // segment-0 text only. For Name:/Oracle:/Text: etc. this is the line's
    // actual value; for A:/T:/R:/S: lines it's the first $-segment's host.
    out.push({
      lineNumber,
      prefix,
      content: (segments[0] ?? "")
        .replaceAll(PIPE_ESCAPE, "|")
        .replaceAll(DOLLAR_ESCAPE, "$")
        .trim(),
      tokens,
    });
  }
  return out;
};
```

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @mtg-forge-ts/cards test lexer`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/cards/src/parser/lexer.ts packages/cards/src/parser/lexer.test.ts
git commit -s -m "feat(cards): lexer — LexedLine tokenization with escape sequences

Forge-compatible tokenization: prefix:content|key\$value|... with
\\| and \\$ escape, # comments, 1-indexed lineNumber preserved
across skips. 8 unit tests including escape round-trip."
```

---

### Task 12: Passthrough line parsers — Name, Oracle, Text, Rules, AI, DeckHas, DeckHints, DeckNeeds

**Files:**
- Create: `packages/cards/src/parser/simple-lines.ts`
- Create: `packages/cards/src/parser/simple-lines.test.ts`

- [ ] **Step 1: Failing test**

```ts
// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, it, expect } from "vitest";
import { lex } from "./lexer.js";
import {
  parseNameLine, parseOracleLine, parseTextLine, parseRulesLine,
  parseAiHintLine, parseDeckHasLine, parseDeckHintsLine, parseDeckNeedsLine,
} from "./simple-lines.js";

describe("simple line parsers", () => {
  it("parseNameLine returns the raw name", () => {
    const lex1 = lex("Name:Lightning Bolt\n");
    expect(parseNameLine(lex1[0]!)).toBe("Lightning Bolt");
  });
  it("parseOracleLine preserves internal pipes via escape", () => {
    const lex1 = lex("Oracle:Foo\\|Bar\n");
    expect(parseOracleLine(lex1[0]!)).toBe("Foo|Bar");
  });
  it("parseTextLine / parseRulesLine mirror parseOracleLine", () => {
    expect(parseTextLine(lex("Text:abc\n")[0]!)).toBe("abc");
    expect(parseRulesLine(lex("Rules:xyz\n")[0]!)).toBe("xyz");
  });
  it("parseAiHintLine captures token map", () => {
    const out = parseAiHintLine(lex("AI:RemoveDeck$All\n")[0]!);
    expect(out.get("RemoveDeck")).toBe("All");
  });
  it("parseDeckHas / Hints / Needs return token map", () => {
    expect(parseDeckHasLine(lex("DeckHas:Ability$Graveyard\n")[0]!).get("Ability")).toBe("Graveyard");
    expect(parseDeckHintsLine(lex("DeckHints:Type$Elf\n")[0]!).get("Type")).toBe("Elf");
    expect(parseDeckNeedsLine(lex("DeckNeeds:Type$Land\n")[0]!).get("Type")).toBe("Land");
  });
});
```

- [ ] **Step 2: Implement**

Create `packages/cards/src/parser/simple-lines.ts`:

```ts
// SPDX-License-Identifier: GPL-3.0-or-later
// Passthrough line parsers: Name, Oracle, Text, Rules, AI, DeckHas,
// DeckHints, DeckNeeds. Each returns either a raw string (for the
// free-text forms) or a flattened key→value Map (for the $-tokenized
// forms).
import type { LexedLine } from "./lexer.js";

const str = (line: LexedLine, expected: string): string => {
  if (line.prefix !== expected) {
    throw new Error(`expected prefix '${expected}', got '${line.prefix}' at line ${line.lineNumber}`);
  }
  return line.content;
};

const flatTokens = (line: LexedLine): ReadonlyMap<string, string> => {
  const out = new Map<string, string>();
  for (const tok of line.tokens) {
    for (const [k, v] of tok) out.set(k, v);
  }
  return out;
};

export const parseNameLine = (line: LexedLine): string => str(line, "Name");
export const parseOracleLine = (line: LexedLine): string => str(line, "Oracle");
export const parseTextLine = (line: LexedLine): string => str(line, "Text");
export const parseRulesLine = (line: LexedLine): string => str(line, "Rules");
export const parseAiHintLine = (line: LexedLine): ReadonlyMap<string, string> => flatTokens(line);
export const parseDeckHasLine = (line: LexedLine): ReadonlyMap<string, string> => flatTokens(line);
export const parseDeckHintsLine = (line: LexedLine): ReadonlyMap<string, string> => flatTokens(line);
export const parseDeckNeedsLine = (line: LexedLine): ReadonlyMap<string, string> => flatTokens(line);
```

- [ ] **Step 3: Run + commit**

```bash
pnpm --filter @mtg-forge-ts/cards test simple-lines
git add packages/cards/src/parser/simple-lines.ts packages/cards/src/parser/simple-lines.test.ts
git commit -s -m "feat(cards): passthrough parsers for Name/Oracle/Text/Rules/AI/DeckHas/DeckHints/DeckNeeds"
```

---

### Task 13: Line parser — Types (`TypeLineAst`)

**Files:**
- Create: `packages/cards/src/parser/type-line.ts`
- Create: `packages/cards/src/parser/type-line.test.ts`

**Forge reference:** `CardType.parseFromFileLine` — space-separated tokens split into supertypes (Legendary, Basic, Snow, World, Elite, Ongoing, Host) vs types (Artifact, Creature, Enchantment, Instant, Land, Planeswalker, Sorcery, Battle, Tribal, Conspiracy, Phenomenon, Plane, Scheme, Vanguard, Dungeon) vs subtypes (everything else). `—` (em-dash) separates type from subtype.

- [ ] **Step 1: Failing test**

```ts
// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, it, expect } from "vitest";
import { lex } from "./lexer.js";
import { parseTypeLine } from "./type-line.js";

describe("parseTypeLine", () => {
  it("parses 'Creature — Human Wizard'", () => {
    const out = parseTypeLine(lex("Types:Creature Human Wizard\n")[0]!);
    expect(out).toEqual({ supertypes: [], types: ["Creature"], subtypes: ["Human", "Wizard"] });
  });
  it("splits Legendary supertype", () => {
    const out = parseTypeLine(lex("Types:Legendary Creature Human\n")[0]!);
    expect(out.supertypes).toEqual(["Legendary"]);
    expect(out.types).toEqual(["Creature"]);
    expect(out.subtypes).toEqual(["Human"]);
  });
  it("handles Instant with no subtypes", () => {
    const out = parseTypeLine(lex("Types:Instant\n")[0]!);
    expect(out).toEqual({ supertypes: [], types: ["Instant"], subtypes: [] });
  });
  it("handles multi-type 'Artifact Creature'", () => {
    const out = parseTypeLine(lex("Types:Artifact Creature Construct\n")[0]!);
    expect(out.types).toEqual(["Artifact", "Creature"]);
    expect(out.subtypes).toEqual(["Construct"]);
  });
  it("handles Land subtypes", () => {
    const out = parseTypeLine(lex("Types:Basic Land Mountain\n")[0]!);
    expect(out.supertypes).toEqual(["Basic"]);
    expect(out.types).toEqual(["Land"]);
    expect(out.subtypes).toEqual(["Mountain"]);
  });
});
```

- [ ] **Step 2: Implement**

Create `packages/cards/src/parser/type-line.ts`:

```ts
// SPDX-License-Identifier: GPL-3.0-or-later
import type { TypeLineAst } from "@mtg-forge-ts/core";
import type { LexedLine } from "./lexer.js";

const SUPERTYPES = new Set(["Legendary", "Basic", "Snow", "World", "Elite", "Ongoing", "Host"]);
const TYPES = new Set([
  "Artifact", "Creature", "Enchantment", "Instant", "Land", "Planeswalker",
  "Sorcery", "Battle", "Tribal", "Conspiracy", "Phenomenon", "Plane",
  "Scheme", "Vanguard", "Dungeon", "Kindred",
]);

export const parseTypeLine = (line: LexedLine): TypeLineAst => {
  if (line.prefix !== "Types") {
    throw new Error(`expected prefix 'Types', got '${line.prefix}' at line ${line.lineNumber}`);
  }
  const tokens = line.content.split(/\s+/).filter((s) => s !== "");
  const supertypes: string[] = [];
  const types: string[] = [];
  const subtypes: string[] = [];
  for (const t of tokens) {
    if (SUPERTYPES.has(t)) supertypes.push(t);
    else if (TYPES.has(t)) types.push(t);
    else subtypes.push(t);
  }
  return { supertypes, types, subtypes };
};
```

- [ ] **Step 3: Run + commit**

```bash
pnpm --filter @mtg-forge-ts/cards test type-line
git add packages/cards/src/parser/type-line.ts packages/cards/src/parser/type-line.test.ts
git commit -s -m "feat(cards): parseTypeLine — split Types: into supertype/type/subtype"
```

---

### Task 14: Line parser — ManaCost (`ManaCostAst`)

**Files:**
- Create: `packages/cards/src/parser/mana-cost-line.ts`
- Create: `packages/cards/src/parser/mana-cost-line.test.ts`

**Forge reference:** `ManaCost.parse` — space-separated mana symbols, each wrapped in `{...}` or bare (Forge accepts both in card scripts). Symbols: integers (generic), W/U/B/R/G/C (color), X/Y/Z (variable), W/U hybrid like `W/U`, `2/W` (monocolored hybrid), `P/W` (phyrexian), `S` (snow), `{½}` (half-mana).

- [ ] **Step 1: Failing test**

```ts
// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, it, expect } from "vitest";
import { lex } from "./lexer.js";
import { parseManaCostLine } from "./mana-cost-line.js";

describe("parseManaCostLine", () => {
  it("parses bare tokens 'R'", () => {
    const out = parseManaCostLine(lex("ManaCost:R\n")[0]!);
    expect(out.raw).toBe("R");
    expect(out.symbols).toHaveLength(1);
  });
  it("parses generic + colored '3 W W'", () => {
    const out = parseManaCostLine(lex("ManaCost:3 W W\n")[0]!);
    expect(out.symbols).toHaveLength(3);
  });
  it("parses no_cost as empty symbols array", () => {
    const out = parseManaCostLine(lex("ManaCost:no cost\n")[0]!);
    expect(out.symbols).toEqual([]);
  });
  it("parses hybrid 'W/U'", () => {
    const out = parseManaCostLine(lex("ManaCost:W/U\n")[0]!);
    expect(out.symbols).toHaveLength(1);
  });
  it("parses phyrexian 'P/W'", () => {
    const out = parseManaCostLine(lex("ManaCost:P/W\n")[0]!);
    expect(out.symbols).toHaveLength(1);
  });
  it("parses X", () => {
    const out = parseManaCostLine(lex("ManaCost:X R\n")[0]!);
    expect(out.symbols).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Implement**

Create `packages/cards/src/parser/mana-cost-line.ts`:

```ts
// SPDX-License-Identifier: GPL-3.0-or-later
import { parseManaSymbol, type ManaCostAst } from "@mtg-forge-ts/core";
import type { LexedLine } from "./lexer.js";

const NO_COST_SENTINELS = new Set(["no cost", "0", ""]);

export const parseManaCostLine = (line: LexedLine): ManaCostAst => {
  if (line.prefix !== "ManaCost") {
    throw new Error(`expected prefix 'ManaCost', got '${line.prefix}' at line ${line.lineNumber}`);
  }
  const raw = line.content;
  if (NO_COST_SENTINELS.has(raw.toLowerCase())) {
    return { raw, symbols: [] };
  }
  const tokens = raw.split(/\s+/).filter((s) => s !== "");
  const symbols = tokens.map((t) => parseManaSymbol(t));
  return { raw, symbols };
};
```

*(Note: `parseManaSymbol` is assumed to already exist in `@mtg-forge-ts/core`'s mana module — it was a SP1 Task. If it doesn't, add a thin wrapper here that the core mana solver consumes directly; mana symbol validation is not this task's concern.)*

- [ ] **Step 3: Run + commit**

```bash
pnpm --filter @mtg-forge-ts/cards test mana-cost-line
git add packages/cards/src/parser/mana-cost-line.ts packages/cards/src/parser/mana-cost-line.test.ts
git commit -s -m "feat(cards): parseManaCostLine — space-tokenized symbol array"
```

---

### Task 15: Line parsers — PT, Loyalty, Defense

**Files:**
- Create: `packages/cards/src/parser/pt-loyalty-defense.ts`
- Create: `packages/cards/src/parser/pt-loyalty-defense.test.ts`

- [ ] **Step 1: Failing test**

```ts
// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, it, expect } from "vitest";
import { lex } from "./lexer.js";
import { parsePtLine, parseLoyaltyLine, parseDefenseLine } from "./pt-loyalty-defense.js";

describe("PT / Loyalty / Defense parsers", () => {
  it("parsePtLine splits '3/4'", () => {
    const out = parsePtLine(lex("PT:3/4\n")[0]!);
    expect(out).toEqual({ power: "3", toughness: "4" });
  });
  it("parsePtLine preserves '*' and '1+*'", () => {
    expect(parsePtLine(lex("PT:*/*\n")[0]!)).toEqual({ power: "*", toughness: "*" });
    expect(parsePtLine(lex("PT:1+*/1+*\n")[0]!)).toEqual({ power: "1+*", toughness: "1+*" });
  });
  it("parsePtLine rejects non-slash input", () => {
    expect(() => parsePtLine(lex("PT:not-a-pt\n")[0]!)).toThrow();
  });
  it("parseLoyaltyLine captures starting value", () => {
    expect(parseLoyaltyLine(lex("Loyalty:4\n")[0]!)).toEqual({ starting: "4" });
  });
  it("parseDefenseLine captures starting value", () => {
    expect(parseDefenseLine(lex("Defense:5\n")[0]!)).toEqual({ starting: "5" });
  });
});
```

- [ ] **Step 2: Implement**

Create `packages/cards/src/parser/pt-loyalty-defense.ts`:

```ts
// SPDX-License-Identifier: GPL-3.0-or-later
import type { DefenseAst, LoyaltyAst, PtAst } from "@mtg-forge-ts/core";
import type { LexedLine } from "./lexer.js";

export const parsePtLine = (line: LexedLine): PtAst => {
  if (line.prefix !== "PT") {
    throw new Error(`expected prefix 'PT', got '${line.prefix}' at line ${line.lineNumber}`);
  }
  const slash = line.content.indexOf("/");
  if (slash < 0) {
    throw new Error(`parsePtLine: missing '/' in '${line.content}' at line ${line.lineNumber}`);
  }
  return {
    power: line.content.slice(0, slash).trim(),
    toughness: line.content.slice(slash + 1).trim(),
  };
};

export const parseLoyaltyLine = (line: LexedLine): LoyaltyAst => {
  if (line.prefix !== "Loyalty") {
    throw new Error(`expected prefix 'Loyalty' at line ${line.lineNumber}`);
  }
  return { starting: line.content.trim() };
};

export const parseDefenseLine = (line: LexedLine): DefenseAst => {
  if (line.prefix !== "Defense") {
    throw new Error(`expected prefix 'Defense' at line ${line.lineNumber}`);
  }
  return { starting: line.content.trim() };
};
```

- [ ] **Step 3: Run + commit**

```bash
pnpm --filter @mtg-forge-ts/cards test pt-loyalty-defense
git add packages/cards/src/parser/pt-loyalty-defense.ts packages/cards/src/parser/pt-loyalty-defense.test.ts
git commit -s -m "feat(cards): PT / Loyalty / Defense line parsers"
```

---

### Task 16: Line parser — Colors

**Files:**
- Create: `packages/cards/src/parser/colors-line.ts`
- Create: `packages/cards/src/parser/colors-line.test.ts`

**Forge reference:** `Colors:` line is comma or space separated list of color names (White, Blue, Black, Red, Green). Used to override inference-from-mana-cost (e.g. a colorless-costed card that is still explicitly colored, like Ghostfire).

- [ ] **Step 1: Failing test**

```ts
// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, it, expect } from "vitest";
import { lex } from "./lexer.js";
import { parseColorsLine } from "./colors-line.js";

describe("parseColorsLine", () => {
  it("parses single color", () => {
    expect(parseColorsLine(lex("Colors:red\n")[0]!)).toEqual({ W: false, U: false, B: false, R: true, G: false });
  });
  it("parses multiple comma-separated colors", () => {
    expect(parseColorsLine(lex("Colors:white,blue\n")[0]!)).toEqual({ W: true, U: true, B: false, R: false, G: false });
  });
  it("parses 'colorless' as all-false", () => {
    expect(parseColorsLine(lex("Colors:colorless\n")[0]!)).toEqual({ W: false, U: false, B: false, R: false, G: false });
  });
});
```

- [ ] **Step 2: Implement**

Create `packages/cards/src/parser/colors-line.ts`:

```ts
// SPDX-License-Identifier: GPL-3.0-or-later
import type { ColorSet } from "@mtg-forge-ts/core";
import type { LexedLine } from "./lexer.js";

const NAME_TO_FLAG: Record<string, keyof ColorSet> = {
  white: "W", w: "W",
  blue: "U", u: "U",
  black: "B", b: "B",
  red: "R", r: "R",
  green: "G", g: "G",
};

export const parseColorsLine = (line: LexedLine): ColorSet => {
  if (line.prefix !== "Colors") {
    throw new Error(`expected prefix 'Colors' at line ${line.lineNumber}`);
  }
  const out: ColorSet = { W: false, U: false, B: false, R: false, G: false };
  if (line.content.trim().toLowerCase() === "colorless") return out;
  for (const tok of line.content.split(/[,\s]+/).filter((s) => s !== "")) {
    const flag = NAME_TO_FLAG[tok.toLowerCase()];
    if (!flag) throw new Error(`unknown color '${tok}' at line ${line.lineNumber}`);
    out[flag] = true;
  }
  return out;
};
```

- [ ] **Step 3: Run + commit**

```bash
pnpm --filter @mtg-forge-ts/cards test colors-line
git add packages/cards/src/parser/colors-line.ts packages/cards/src/parser/colors-line.test.ts
git commit -s -m "feat(cards): parseColorsLine — color-name to ColorSet"
```

---

### Task 17: Line parser — Ability (SP$/AB$/DB$ → `AbilityAst`)

**Files:**
- Create: `packages/cards/src/parser/ability-line.ts`
- Create: `packages/cards/src/parser/ability-line.test.ts`

**Forge reference:** `AbilityFactory.parseAbility` — first token is `SP$ X` (spell), `AB$ X` (activated), or `DB$ X` (dependent sub-ability). `X` is the handler key. Remaining tokens are params. `Cost$` token holds the cost string. `SubAbility$ DBname` chains to an SVar-defined sub-ability. `SpellDescription$` is the stack-description text.

- [ ] **Step 1: Failing test**

```ts
// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, it, expect } from "vitest";
import { lex } from "./lexer.js";
import { parseAbilityLine } from "./ability-line.js";

describe("parseAbilityLine", () => {
  it("parses a simple SP$ DealDamage spell", () => {
    const out = parseAbilityLine(lex("A:SP$ DealDamage | Cost$ R | NumDmg$ 3 | ValidTgts$ Any\n")[0]!);
    expect(out.kind).toBe("spell");
    expect(out.effect.handlerKey).toBe("DealDamage");
    expect(out.effect.params["NumDmg"]).toEqual({ kind: "literal", raw: "3" });
    expect(out.effect.params["ValidTgts"]).toEqual({ kind: "literal", raw: "Any" });
    expect(out.cost.raw).toBe("R");
  });

  it("parses an AB$ activated ability with tap cost", () => {
    const out = parseAbilityLine(lex("A:AB$ Mana | Cost$ T | Produced$ G\n")[0]!);
    expect(out.kind).toBe("activated");
    expect(out.effect.handlerKey).toBe("Mana");
    expect(out.cost.raw).toBe("T");
  });

  it("parses a DB$ sub-ability (inline)", () => {
    const out = parseAbilityLine(lex("A:DB$ Draw | NumCards$ 1\n")[0]!);
    expect(out.kind).toBe("spell");           // DB$ is a spell-shape (no cost)
    expect(out.effect.handlerKey).toBe("Draw");
  });

  it("resolves X as svarRef, literal 3 as literal", () => {
    const out = parseAbilityLine(lex("A:SP$ DealDamage | Cost$ X R | NumDmg$ X | ValidTgts$ Any\n")[0]!);
    expect(out.effect.params["NumDmg"]).toEqual({ kind: "svarRef", name: "X" });
  });

  it("handles SubAbility$ reference", () => {
    const out = parseAbilityLine(lex("A:SP$ DealDamage | Cost$ R | NumDmg$ 2 | SubAbility$ DBDraw\n")[0]!);
    expect(out.effect.params["SubAbility"]).toEqual({ kind: "svarRef", name: "DBDraw" });
  });

  it("captures Count\\$ expression", () => {
    const out = parseAbilityLine(lex("A:SP$ DealDamage | Cost$ R | NumDmg$ Count\\$yourHand\n")[0]!);
    const pv = out.effect.params["NumDmg"];
    if (pv?.kind !== "expression") throw new Error("expected expression ParamValue");
    expect(pv.ast.raw).toBe("Count$yourHand");
  });
});
```

- [ ] **Step 2: Implement**

Create `packages/cards/src/parser/ability-line.ts`:

```ts
// SPDX-License-Identifier: GPL-3.0-or-later
import type { AbilityAst, EffectInvocation, ParamValue, SVarExpressionAst } from "@mtg-forge-ts/core";
import type { LexedLine } from "./lexer.js";

const SVAR_REF_RE = /^[XYZ]$|^DB[A-Z]\w*$/;

export const classifyParamValue = (raw: string): ParamValue => {
  if (SVAR_REF_RE.test(raw)) return { kind: "svarRef", name: raw };
  if (raw.includes("$")) {
    // Compound expression: Count$xPaid, Number$X, SumPower$Creature.YouCtrl etc.
    const dollar = raw.indexOf("$");
    const kind = raw.slice(0, dollar);
    const rest = raw.slice(dollar + 1);
    const ast: SVarExpressionAst = { kind, raw, args: rest === "" ? undefined : [{ kind: "literal", raw: rest }] };
    return { kind: "expression", ast };
  }
  return { kind: "literal", raw };
};

export const parseAbilityLine = (line: LexedLine): AbilityAst => {
  if (line.prefix !== "A") {
    throw new Error(`expected prefix 'A' at line ${line.lineNumber}`);
  }
  let kind: "spell" | "activated" = "spell";
  let handlerKey: string | null = null;
  let costRaw = "";
  const params: Record<string, ParamValue> = {};
  for (const tok of line.tokens) {
    for (const [k, v] of tok) {
      if (k === "SP" || k === "DB") {
        kind = "spell";
        handlerKey = v;
      } else if (k === "AB") {
        kind = "activated";
        handlerKey = v;
      } else if (k === "Cost") {
        costRaw = v;
      } else {
        params[k] = classifyParamValue(v);
      }
    }
  }
  if (handlerKey === null) {
    throw new Error(`parseAbilityLine: no SP\$/AB\$/DB\$ handler at line ${line.lineNumber}`);
  }
  const effect: EffectInvocation = { handlerKey, params };
  return { kind, effect, cost: { raw: costRaw } };
};
```

- [ ] **Step 3: Run + commit**

```bash
pnpm --filter @mtg-forge-ts/cards test ability-line
git add packages/cards/src/parser/ability-line.ts packages/cards/src/parser/ability-line.test.ts
git commit -s -m "feat(cards): parseAbilityLine — SP\$/AB\$/DB\$ + Cost\$ + params"
```

---

### Task 18: Line parser — Trigger (T: + Mode$ → `TriggerAst`)

**Files:**
- Create: `packages/cards/src/parser/trigger-line.ts`
- Create: `packages/cards/src/parser/trigger-line.test.ts`

**Forge reference:** `TriggerHandler.parseTrigger` — `T: Mode$ <TriggerMode> | ValidCard$ ... | Execute$ DBname | TriggerDescription$ text`.

- [ ] **Step 1: Failing test**

```ts
// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, it, expect } from "vitest";
import { lex } from "./lexer.js";
import { parseTriggerLine } from "./trigger-line.js";

describe("parseTriggerLine", () => {
  it("parses ChangesZone trigger pointing at Execute svar", () => {
    const out = parseTriggerLine(lex("T:Mode$ ChangesZone | Origin$ Any | Destination$ Battlefield | ValidCard$ Card.Self | Execute$ TrigDraw | TriggerDescription$ When this enters, draw a card.\n")[0]!);
    expect(out.mode).toBe("ChangesZone");
    expect(out.params["Origin"]).toEqual({ kind: "literal", raw: "Any" });
    expect(out.params["Destination"]).toEqual({ kind: "literal", raw: "Battlefield" });
    expect(out.params["ValidCard"]).toEqual({ kind: "literal", raw: "Card.Self" });
    expect(out.effect.handlerKey).toBe("TrigDraw");
  });

  it("rejects triggers without Mode\$", () => {
    expect(() => parseTriggerLine(lex("T:NoMode\n")[0]!)).toThrow();
  });
});
```

- [ ] **Step 2: Implement**

Create `packages/cards/src/parser/trigger-line.ts`:

```ts
// SPDX-License-Identifier: GPL-3.0-or-later
import type { ParamValue, TriggerAst } from "@mtg-forge-ts/core";
import type { LexedLine } from "./lexer.js";
import { classifyParamValue } from "./ability-line.js";

export const parseTriggerLine = (line: LexedLine): TriggerAst => {
  if (line.prefix !== "T") {
    throw new Error(`expected prefix 'T' at line ${line.lineNumber}`);
  }
  let mode: string | null = null;
  let executeKey: string | null = null;
  const params: Record<string, ParamValue> = {};
  for (const tok of line.tokens) {
    for (const [k, v] of tok) {
      if (k === "Mode") mode = v;
      else if (k === "Execute") executeKey = v;
      else params[k] = classifyParamValue(v);
    }
  }
  if (mode === null) throw new Error(`parseTriggerLine: missing Mode\$ at line ${line.lineNumber}`);
  if (executeKey === null) throw new Error(`parseTriggerLine: missing Execute\$ at line ${line.lineNumber}`);
  return {
    mode,
    params,
    effect: { handlerKey: executeKey, params: {} },
  };
};
```

- [ ] **Step 3: Run + commit**

```bash
pnpm --filter @mtg-forge-ts/cards test trigger-line
git add packages/cards/src/parser/trigger-line.ts packages/cards/src/parser/trigger-line.test.ts
git commit -s -m "feat(cards): parseTriggerLine — T: Mode\$ X | ... | Execute\$ DB..."
```

---

### Task 19: Line parser — Replacement (R: + Event$ → `ReplacementAst`)

**Files:**
- Create: `packages/cards/src/parser/replacement-line.ts`
- Create: `packages/cards/src/parser/replacement-line.test.ts`

**Forge reference:** `R: Event$ <ReplacementType> | ... | ReplaceWith$ DBname | Description$ text`.

- [ ] **Step 1: Failing test**

```ts
// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, it, expect } from "vitest";
import { lex } from "./lexer.js";
import { parseReplacementLine } from "./replacement-line.js";

describe("parseReplacementLine", () => {
  it("parses Moved replacement with ReplaceWith", () => {
    const out = parseReplacementLine(lex("R:Event$ Moved | Origin$ Any | Destination$ Graveyard | ValidCard$ Card.Self | ReplaceWith$ DBExile | Description$ If this would die, exile it instead.\n")[0]!);
    expect(out.eventKind).toBe("Moved");
    expect(out.params["Origin"]).toEqual({ kind: "literal", raw: "Any" });
    expect(out.effect.handlerKey).toBe("DBExile");
  });

  it("rejects replacements without Event\$", () => {
    expect(() => parseReplacementLine(lex("R:NoEvent\n")[0]!)).toThrow();
  });

  it("flags self-replacement via Self\$", () => {
    const out = parseReplacementLine(lex("R:Event$ Moved | Self$ True | ReplaceWith$ DBExile\n")[0]!);
    expect(out.isSelf).toBe(true);
  });
});
```

- [ ] **Step 2: Implement**

Create `packages/cards/src/parser/replacement-line.ts`:

```ts
// SPDX-License-Identifier: GPL-3.0-or-later
import { replacementTypeFromName, type ParamValue, type ReplacementAst } from "@mtg-forge-ts/core";
import type { LexedLine } from "./lexer.js";
import { classifyParamValue } from "./ability-line.js";

export const parseReplacementLine = (line: LexedLine): ReplacementAst => {
  if (line.prefix !== "R") {
    throw new Error(`expected prefix 'R' at line ${line.lineNumber}`);
  }
  let eventKind: string | null = null;
  let replaceWith: string | null = null;
  let isSelf = false;
  const params: Record<string, ParamValue> = {};
  for (const tok of line.tokens) {
    for (const [k, v] of tok) {
      if (k === "Event") {
        const canonical = replacementTypeFromName(v);
        if (canonical === null) {
          throw new Error(`parseReplacementLine: unknown Event\$ '${v}' at line ${line.lineNumber}`);
        }
        eventKind = canonical;
      } else if (k === "ReplaceWith") {
        replaceWith = v;
      } else if (k === "Self") {
        isSelf = v.toLowerCase() === "true";
      } else {
        params[k] = classifyParamValue(v);
      }
    }
  }
  if (eventKind === null) throw new Error(`parseReplacementLine: missing Event\$ at line ${line.lineNumber}`);
  if (replaceWith === null) throw new Error(`parseReplacementLine: missing ReplaceWith\$ at line ${line.lineNumber}`);
  return {
    eventKind,
    params,
    effect: { handlerKey: replaceWith, params: {} },
    ...(isSelf ? { isSelf: true } : {}),
  };
};
```

- [ ] **Step 3: Run + commit**

```bash
pnpm --filter @mtg-forge-ts/cards test replacement-line
git add packages/cards/src/parser/replacement-line.ts packages/cards/src/parser/replacement-line.test.ts
git commit -s -m "feat(cards): parseReplacementLine — R: Event\$ ReplacementType | ReplaceWith\$ DB..."
```

---

### Task 20: Line parser — Static (S: + Mode$ → `StaticAst`)

**Files:**
- Create: `packages/cards/src/parser/static-line.ts`
- Create: `packages/cards/src/parser/static-line.test.ts`

**Forge reference:** `S: Mode$ <StaticAbilityMode> | ... | EffectZone$ <zones> | Description$ text`.

- [ ] **Step 1: Failing test**

```ts
// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, it, expect } from "vitest";
import { lex } from "./lexer.js";
import { parseStaticLine } from "./static-line.js";

describe("parseStaticLine", () => {
  it("parses Continuous static with default zone Battlefield", () => {
    const out = parseStaticLine(lex("S:Mode$ Continuous | Affected$ Creature.Other+YouCtrl | AddPower$ 1 | AddToughness$ 1 | Description$ Other creatures you control get +1/+1.\n")[0]!);
    expect(out.mode).toBe("Continuous");
    expect(out.activeInZones).toEqual(["battlefield"]);
  });

  it("parses CantBeCast with EffectZone override", () => {
    const out = parseStaticLine(lex("S:Mode$ CantBeCast | ValidCard$ Card.Self | EffectZone$ All | Description$ You can't cast this.\n")[0]!);
    expect(out.mode).toBe("CantBeCast");
    expect(out.activeInZones).toEqual(["all"]);
  });

  it("rejects unknown StaticAbilityMode", () => {
    expect(() => parseStaticLine(lex("S:Mode$ NotAThing\n")[0]!)).toThrow(/unknown StaticAbilityMode/);
  });
});
```

- [ ] **Step 2: Implement**

Create `packages/cards/src/parser/static-line.ts`:

```ts
// SPDX-License-Identifier: GPL-3.0-or-later
import { staticAbilityModeFromName, type ParamValue, type StaticAst, type ZoneType } from "@mtg-forge-ts/core";
import type { LexedLine } from "./lexer.js";
import { classifyParamValue } from "./ability-line.js";

const parseZoneList = (raw: string): readonly ZoneType[] => {
  const tokens = raw.split(/[,\s]+/).filter((s) => s !== "");
  return tokens.map((t) => t.toLowerCase() as ZoneType);
};

export const parseStaticLine = (line: LexedLine): StaticAst => {
  if (line.prefix !== "S") {
    throw new Error(`expected prefix 'S' at line ${line.lineNumber}`);
  }
  let mode: string | null = null;
  let activeInZones: readonly ZoneType[] = ["battlefield" as ZoneType];
  const params: Record<string, ParamValue> = {};
  for (const tok of line.tokens) {
    for (const [k, v] of tok) {
      if (k === "Mode") {
        const canonical = staticAbilityModeFromName(v);
        if (canonical === null) {
          throw new Error(`unknown StaticAbilityMode '${v}' at line ${line.lineNumber}`);
        }
        mode = canonical;
      } else if (k === "EffectZone") {
        activeInZones = parseZoneList(v);
      } else {
        params[k] = classifyParamValue(v);
      }
    }
  }
  if (mode === null) throw new Error(`parseStaticLine: missing Mode\$ at line ${line.lineNumber}`);
  return { mode, params, activeInZones };
};
```

- [ ] **Step 3: Run + commit**

```bash
pnpm --filter @mtg-forge-ts/cards test static-line
git add packages/cards/src/parser/static-line.ts packages/cards/src/parser/static-line.test.ts
git commit -s -m "feat(cards): parseStaticLine — S: Mode\$ StaticAbilityMode | EffectZone\$ ..."
```

---

### Task 21: Line parser — Keyword (K: → `KeywordAst` with `KeywordId` resolved)

**Files:**
- Create: `packages/cards/src/parser/keyword-line.ts`
- Create: `packages/cards/src/parser/keyword-line.test.ts`

**Forge reference:** `Keyword.getKeywordDetails` — handles three shapes:
- Simple keyword: `K:Flying` → id=`flying`, no params.
- Colon-parameterized: `K:Kicker:2 R` → id=`kicker`, params={cost:"2 R"}.
- Space-parameterized (rare): `K:First Strike` → id=`first_strike`. Display-name lookup via `keywordIdFromDisplayName`.

- [ ] **Step 1: Failing test**

```ts
// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, it, expect } from "vitest";
import { lex } from "./lexer.js";
import { parseKeywordLine } from "./keyword-line.js";

describe("parseKeywordLine", () => {
  it("parses simple 'K:Flying'", () => {
    const out = parseKeywordLine(lex("K:Flying\n")[0]!);
    expect(out.keyword).toBe("flying");
    expect(out.params).toBeUndefined();
  });
  it("parses 'K:First Strike' (display name with space)", () => {
    const out = parseKeywordLine(lex("K:First Strike\n")[0]!);
    expect(out.keyword).toBe("first_strike");
  });
  it("parses 'K:Kicker:2 R' with cost param", () => {
    const out = parseKeywordLine(lex("K:Kicker:2 R\n")[0]!);
    expect(out.keyword).toBe("kicker");
    expect(out.params?.["cost"]).toEqual({ kind: "literal", raw: "2 R" });
  });
  it("parses 'K:Bushido:2' with amount param", () => {
    const out = parseKeywordLine(lex("K:Bushido:2\n")[0]!);
    expect(out.keyword).toBe("bushido");
    expect(out.params?.["amount"]).toEqual({ kind: "literal", raw: "2" });
  });
  it("rejects unknown keyword", () => {
    expect(() => parseKeywordLine(lex("K:Notakeyword\n")[0]!)).toThrow(/unknown keyword/);
  });
});
```

- [ ] **Step 2: Implement**

Create `packages/cards/src/parser/keyword-line.ts`:

```ts
// SPDX-License-Identifier: GPL-3.0-or-later
import {
  keywordIdFromDisplayName,
  type KeywordAst,
  type KeywordId,
  type ParamValue,
} from "@mtg-forge-ts/core";
import type { LexedLine } from "./lexer.js";

// Keywords that parameterize with a cost string (the ":cost" suffix).
const COST_KEYWORDS: ReadonlySet<KeywordId> = new Set<KeywordId>([
  "kicker", "multikicker", "bestow", "buyback", "cycling", "dash", "disturb",
  "echo", "embalm", "emerge", "entwine", "eternalize", "escape", "evoke",
  "fortify", "flashback", "foretell", "freerunning", "harmonize", "level_up",
  "madness", "mayhem", "megamorph", "miracle", "more_than_meets_the_eye",
  "morph", "ninjutsu", "outlast", "overload", "plot", "prototype", "prowl",
  "reconfigure", "reflect", "scavenge", "specialize", "spectacle", "squad",
  "surge", "transfigure", "transmute", "unearth", "ward", "warp",
  "web_slinging", "cumulative_upkeep", "aura_swap", "equip", "cycling",
  "disguise",
]);

// Keywords that parameterize with a numeric amount.
const AMOUNT_KEYWORDS: ReadonlySet<KeywordId> = new Set<KeywordId>([
  "absorb", "afflict", "afterlife", "annihilator", "awaken", "backup",
  "bloodthirst", "bushido", "casualty", "crew", "dredge", "fabricate",
  "fading", "frenzy", "graft", "hideaway", "mobilize", "poisonous",
  "rampage", "reinforce", "renown", "ripple", "saddle", "soulshift",
  "station", "toxic", "tribute", "vanishing", "impending",
]);

// Keywords that parameterize with a type string.
const TYPE_KEYWORDS: ReadonlySet<KeywordId> = new Set<KeywordId>([
  "bands_with_other", "champion", "enchant", "landwalk", "offering",
  "partner_with", "typecycling",
]);

const resolveKeywordId = (raw: string, lineNumber: number): KeywordId => {
  // Try direct canonical id first (lowercase_snake_case already).
  const canonical = raw.toLowerCase().replace(/[\s\-]+/g, "_");
  const byCanonical = keywordIdFromDisplayName(raw) ?? keywordIdFromDisplayName(canonical.replace(/_/g, " "));
  if (byCanonical) return byCanonical;
  throw new Error(`unknown keyword '${raw}' at line ${lineNumber}`);
};

export const parseKeywordLine = (line: LexedLine): KeywordAst => {
  if (line.prefix !== "K") {
    throw new Error(`expected prefix 'K' at line ${line.lineNumber}`);
  }
  const raw = line.content;
  const colonIdx = raw.indexOf(":");
  if (colonIdx < 0) {
    const keyword = resolveKeywordId(raw, line.lineNumber);
    return { keyword };
  }
  const head = raw.slice(0, colonIdx).trim();
  const tail = raw.slice(colonIdx + 1).trim();
  const keyword = resolveKeywordId(head, line.lineNumber);
  const params: Record<string, ParamValue> = {};
  if (COST_KEYWORDS.has(keyword)) params["cost"] = { kind: "literal", raw: tail };
  else if (AMOUNT_KEYWORDS.has(keyword)) params["amount"] = { kind: "literal", raw: tail };
  else if (TYPE_KEYWORDS.has(keyword)) params["type"] = { kind: "literal", raw: tail };
  else params["detail"] = { kind: "literal", raw: tail };
  return { keyword, params };
};
```

- [ ] **Step 3: Run + commit**

```bash
pnpm --filter @mtg-forge-ts/cards test keyword-line
git add packages/cards/src/parser/keyword-line.ts packages/cards/src/parser/keyword-line.test.ts
git commit -s -m "feat(cards): parseKeywordLine — K: + canonical KeywordId resolution"
```

---

### Task 22: Line parser — SVar

**Files:**
- Create: `packages/cards/src/parser/svar-line.ts`
- Create: `packages/cards/src/parser/svar-line.test.ts`

**Forge reference:** `SVar:<name>:<expression>` where `<expression>` is either a value expression (`Count$xPaid`, `Number$5`, arithmetic) or an inline ability (`DB$ DealDamage | NumDmg$ X | ...`).

- [ ] **Step 1: Failing test**

```ts
// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, it, expect } from "vitest";
import { lex } from "./lexer.js";
import { parseSVarLine } from "./svar-line.js";

describe("parseSVarLine", () => {
  it("parses a value SVar", () => {
    const out = parseSVarLine(lex("SVar:X:Count$xPaid\n")[0]!);
    expect(out.name).toBe("X");
    expect(out.ast.kind).toBe("value");
    expect(out.ast.expression?.kind).toBe("Count");
    expect(out.ast.expression?.raw).toBe("Count$xPaid");
  });
  it("parses an ability SVar", () => {
    const out = parseSVarLine(lex("SVar:TrigDraw:DB$ Draw | NumCards$ 1\n")[0]!);
    expect(out.ast.kind).toBe("ability");
    expect(out.ast.ability?.handlerKey).toBe("Draw");
  });
});
```

- [ ] **Step 2: Implement**

Create `packages/cards/src/parser/svar-line.ts`:

```ts
// SPDX-License-Identifier: GPL-3.0-or-later
import type { EffectInvocation, ParamValue, SVarAst, SVarExpressionAst } from "@mtg-forge-ts/core";
import type { LexedLine } from "./lexer.js";
import { classifyParamValue } from "./ability-line.js";

export const parseSVarLine = (line: LexedLine): { readonly name: string; readonly ast: SVarAst } => {
  if (line.prefix !== "SVar") {
    throw new Error(`expected prefix 'SVar' at line ${line.lineNumber}`);
  }
  // Re-lex from raw content + tokens: the lexer already split on first pipe,
  // so line.content = "name:expression-head" and line.tokens[0..] = the
  // rest of the ability body (for ability SVars).
  const firstColon = line.content.indexOf(":");
  if (firstColon < 0) throw new Error(`parseSVarLine: missing ':' separator at line ${line.lineNumber}`);
  const name = line.content.slice(0, firstColon).trim();
  const head = line.content.slice(firstColon + 1).trim();
  // Ability SVar — starts with DB$ <handler>
  if (head.startsWith("DB$ ")) {
    const handlerKey = head.slice(4).trim();
    const params: Record<string, ParamValue> = {};
    for (const tok of line.tokens) {
      for (const [k, v] of tok) {
        params[k] = classifyParamValue(v);
      }
    }
    const ability: EffectInvocation = { handlerKey, params };
    return { name, ast: { kind: "ability", raw: head, ability } };
  }
  // Value SVar — head is "Kind$args" or a literal number
  const dollar = head.indexOf("$");
  if (dollar < 0) {
    return { name, ast: { kind: "value", raw: head } };
  }
  const expression: SVarExpressionAst = {
    kind: head.slice(0, dollar),
    raw: head,
    args: [{ kind: "literal", raw: head.slice(dollar + 1) }],
  };
  return { name, ast: { kind: "value", raw: head, expression } };
};
```

- [ ] **Step 3: Run + commit**

```bash
pnpm --filter @mtg-forge-ts/cards test svar-line
git add packages/cards/src/parser/svar-line.ts packages/cards/src/parser/svar-line.test.ts
git commit -s -m "feat(cards): parseSVarLine — value and ability SVar forms"
```

---

### Task 23: AST assembler — combine lines into `CardDefinition`

**Files:**
- Create: `packages/cards/src/parser/assembler.ts`
- Create: `packages/cards/src/parser/assembler.test.ts`

**Context:** Takes lexed lines, dispatches each to its per-prefix parser, assembles a `CardDefinition`. Unknown prefixes → error (unless a future `@tolerate-unknown` escape hatch is added; not in scope).

- [ ] **Step 1: Failing test**

```ts
// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, it, expect } from "vitest";
import { parseCard } from "./assembler.js";

describe("parseCard assembler", () => {
  it("parses Lightning Bolt end-to-end", () => {
    const source = [
      "Name:Lightning Bolt",
      "ManaCost:R",
      "Types:Instant",
      "A:SP$ DealDamage | Cost$ R | NumDmg$ 3 | ValidTgts$ Any | SpellDescription$ CARDNAME deals 3 damage to any target.",
      "Oracle:Lightning Bolt deals 3 damage to any target.",
    ].join("\n") + "\n";
    const card = parseCard(source, "lightning_bolt.txt");
    expect(card.name).toBe("Lightning Bolt");
    expect(card.types.types).toEqual(["Instant"]);
    expect(card.manaCost?.raw).toBe("R");
    expect(card.abilities).toHaveLength(1);
    expect(card.oracle).toBe("Lightning Bolt deals 3 damage to any target.");
  });

  it("parses Grizzly Bears with creature keywords", () => {
    const source = [
      "Name:Grizzly Bears",
      "ManaCost:1 G",
      "Types:Creature Bear",
      "PT:2/2",
      "Oracle:A strong creature.",
    ].join("\n") + "\n";
    const card = parseCard(source, "grizzly_bears.txt");
    expect(card.pt).toEqual({ power: "2", toughness: "2" });
  });

  it("parses SVar reference", () => {
    const source = [
      "Name:Fireball",
      "ManaCost:X R",
      "Types:Sorcery",
      "A:SP$ DealDamage | Cost$ X R | NumDmg$ X | ValidTgts$ Any",
      "SVar:X:Count$xPaid",
    ].join("\n") + "\n";
    const card = parseCard(source, "fireball.txt");
    expect(card.svars.get("X")?.raw).toBe("Count$xPaid");
  });

  it("rejects unknown prefix", () => {
    const source = "Name:Bolt\nNotARealPrefix:foo\n";
    expect(() => parseCard(source, "x.txt")).toThrow(/unknown prefix 'NotARealPrefix'/);
  });
});
```

- [ ] **Step 2: Implement**

Create `packages/cards/src/parser/assembler.ts`:

```ts
// SPDX-License-Identifier: GPL-3.0-or-later
import type {
  AbilityAst, CardDefinition, DefenseAst, KeywordAst, LoyaltyAst, ManaCostAst,
  PtAst, ReplacementAst, StaticAst, SVarAst, TriggerAst, TypeLineAst, ColorSet,
} from "@mtg-forge-ts/core";
import { lex, type LexedLine } from "./lexer.js";
import { parseAbilityLine } from "./ability-line.js";
import { parseColorsLine } from "./colors-line.js";
import { parseKeywordLine } from "./keyword-line.js";
import { parseManaCostLine } from "./mana-cost-line.js";
import { parsePtLine, parseLoyaltyLine, parseDefenseLine } from "./pt-loyalty-defense.js";
import { parseReplacementLine } from "./replacement-line.js";
import {
  parseAiHintLine, parseDeckHasLine, parseDeckHintsLine, parseDeckNeedsLine,
  parseNameLine, parseOracleLine, parseRulesLine, parseTextLine,
} from "./simple-lines.js";
import { parseStaticLine } from "./static-line.js";
import { parseSVarLine } from "./svar-line.js";
import { parseTriggerLine } from "./trigger-line.js";
import { parseTypeLine } from "./type-line.js";

interface AssemblerState {
  name: string | null;
  manaCost: ManaCostAst | null;
  colors: ColorSet | null;
  types: TypeLineAst | null;
  pt: PtAst | null;
  loyalty: LoyaltyAst | null;
  defense: DefenseAst | null;
  abilities: AbilityAst[];
  triggers: TriggerAst[];
  replacements: ReplacementAst[];
  statics: StaticAst[];
  keywords: KeywordAst[];
  svars: Map<string, SVarAst>;
  aiHints: ReadonlyMap<string, string>[];
  oracle: string;
  rulesText: string;
}

const freshState = (): AssemblerState => ({
  name: null,
  manaCost: null,
  colors: null,
  types: null,
  pt: null,
  loyalty: null,
  defense: null,
  abilities: [],
  triggers: [],
  replacements: [],
  statics: [],
  keywords: [],
  svars: new Map(),
  aiHints: [],
  oracle: "",
  rulesText: "",
});

const dispatch = (line: LexedLine, st: AssemblerState): void => {
  switch (line.prefix) {
    case "Name": st.name = parseNameLine(line); break;
    case "ManaCost": st.manaCost = parseManaCostLine(line); break;
    case "Colors": st.colors = parseColorsLine(line); break;
    case "Types": st.types = parseTypeLine(line); break;
    case "PT": st.pt = parsePtLine(line); break;
    case "Loyalty": st.loyalty = parseLoyaltyLine(line); break;
    case "Defense": st.defense = parseDefenseLine(line); break;
    case "A": st.abilities.push(parseAbilityLine(line)); break;
    case "T": st.triggers.push(parseTriggerLine(line)); break;
    case "R": st.replacements.push(parseReplacementLine(line)); break;
    case "S": st.statics.push(parseStaticLine(line)); break;
    case "K": st.keywords.push(parseKeywordLine(line)); break;
    case "SVar": {
      const { name, ast } = parseSVarLine(line);
      st.svars.set(name, ast);
      break;
    }
    case "AI": st.aiHints.push(parseAiHintLine(line)); break;
    case "DeckHas": st.aiHints.push(parseDeckHasLine(line)); break;
    case "DeckHints": st.aiHints.push(parseDeckHintsLine(line)); break;
    case "DeckNeeds": st.aiHints.push(parseDeckNeedsLine(line)); break;
    case "Oracle": st.oracle = parseOracleLine(line); break;
    case "Text": {
      const t = parseTextLine(line);
      st.rulesText = st.rulesText === "" ? t : `${st.rulesText}\n${t}`;
      break;
    }
    case "Rules": {
      const t = parseRulesLine(line);
      st.rulesText = st.rulesText === "" ? t : `${st.rulesText}\n${t}`;
      break;
    }
    case "AlternateMode":
      // Handled by Task 24 (faces). For now, noop passthrough.
      break;
    case "HandLifeModifier":
      // Commander-specific metadata; noop for parser.
      break;
    default:
      throw new Error(`unknown prefix '${line.prefix}' at line ${line.lineNumber}`);
  }
};

export const parseCard = (source: string, file: string): CardDefinition => {
  const lines = lex(source);
  const st = freshState();
  for (const line of lines) dispatch(line, st);
  if (st.name === null) throw new Error(`${file}: missing Name: line`);
  if (st.types === null) throw new Error(`${file}: missing Types: line`);
  const def: CardDefinition = {
    name: st.name,
    oracle: st.oracle,
    types: st.types,
    manaCost: st.manaCost,
    ...(st.pt ? { pt: st.pt } : {}),
    ...(st.loyalty ? { loyalty: st.loyalty.starting } : {}),
    ...(st.defense ? { defense: st.defense.starting } : {}),
    ...(st.colors ? { colors: st.colors } : {}),
    abilities: st.abilities,
    triggers: st.triggers,
    replacements: st.replacements,
    statics: st.statics,
    keywords: st.keywords,
    svars: st.svars,
  };
  return def;
};
```

- [ ] **Step 3: Run + commit**

```bash
pnpm --filter @mtg-forge-ts/cards test assembler
git add packages/cards/src/parser/assembler.ts packages/cards/src/parser/assembler.test.ts
git commit -s -m "feat(cards): AST assembler — parseCard(source, file) → CardDefinition"
```

---

### Task 24: Multi-face support — `AlternateMode:`

**Files:**
- Modify: `packages/cards/src/parser/assembler.ts`
- Create: `packages/cards/src/parser/faces.test.ts`

**Forge reference:** Cards with multiple faces (split, flip, DFC, MDFC, adventure, meld) use `AlternateMode:` lines as **section separators**. A single .txt file contains N face sections, each a complete card-like block. The first face is the primary; subsequent faces are pushed into `CardDefinition.faces[]`. Face order matters (DFC face A is the "front", face B is the "back").

- [ ] **Step 1: Failing test**

Create `packages/cards/src/parser/faces.test.ts`:

```ts
// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, it, expect } from "vitest";
import { parseCard } from "./assembler.js";

describe("parseCard — multi-face", () => {
  it("parses a DFC (Delver of Secrets // Insectile Aberration)", () => {
    const source = [
      "Name:Delver of Secrets",
      "ManaCost:U",
      "Types:Creature Human Wizard",
      "PT:1/1",
      "T:Mode$ Phase | Phase$ Upkeep | Execute$ TrigPeek",
      "SVar:TrigPeek:DB$ Scry | Amount$ 1",
      "Oracle:At the beginning of your upkeep...",
      "AlternateMode:DoubleFaced",
      "Name:Insectile Aberration",
      "Types:Creature Human Insect",
      "PT:3/2",
      "K:Flying",
      "Oracle:",
    ].join("\n") + "\n";
    const card = parseCard(source, "delver.txt");
    expect(card.name).toBe("Delver of Secrets");
    expect(card.faces).toHaveLength(1);
    expect(card.faces?.[0]?.name).toBe("Insectile Aberration");
    expect(card.faces?.[0]?.keywords).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Update assembler to handle `AlternateMode:`**

Edit `packages/cards/src/parser/assembler.ts` — replace the single-state dispatch with a face-aware loop:

```ts
// New top-level function that splits on AlternateMode: sections.
export const parseCard = (source: string, file: string): CardDefinition => {
  const allLines = lex(source);
  const sections: LexedLine[][] = [[]];
  for (const line of allLines) {
    if (line.prefix === "AlternateMode") {
      sections.push([]);
    } else {
      sections[sections.length - 1]!.push(line);
    }
  }
  const parseSection = (linesInSection: LexedLine[]): CardDefinition => {
    const st = freshState();
    for (const line of linesInSection) dispatch(line, st);
    if (st.name === null) throw new Error(`${file}: face missing Name: line`);
    if (st.types === null) throw new Error(`${file}: face '${st.name}' missing Types: line`);
    return finalizeDefinition(st);
  };
  const primary = parseSection(sections[0]!);
  if (sections.length === 1) return primary;
  const faces = sections.slice(1).map(parseSection);
  return { ...primary, faces };
};

const finalizeDefinition = (st: AssemblerState): CardDefinition => {
  return {
    name: st.name!,
    oracle: st.oracle,
    types: st.types!,
    manaCost: st.manaCost,
    ...(st.pt ? { pt: st.pt } : {}),
    ...(st.loyalty ? { loyalty: st.loyalty.starting } : {}),
    ...(st.defense ? { defense: st.defense.starting } : {}),
    ...(st.colors ? { colors: st.colors } : {}),
    abilities: st.abilities,
    triggers: st.triggers,
    replacements: st.replacements,
    statics: st.statics,
    keywords: st.keywords,
    svars: st.svars,
  };
};
```

- [ ] **Step 3: Run + commit**

```bash
pnpm --filter @mtg-forge-ts/cards test faces
git add packages/cards/src/parser/assembler.ts packages/cards/src/parser/faces.test.ts
git commit -s -m "feat(cards): multi-face parsing — AlternateMode: section split"
```

---

### Task 25: Intra-card reference resolution — `SubAbility$ DBX`, `SVar$ X`

**Files:**
- Modify: `packages/cards/src/parser/assembler.ts` (add post-pass resolver)
- Create: `packages/cards/src/parser/resolver.ts`
- Create: `packages/cards/src/parser/resolver.test.ts`

**Context:** After assembly, walk every `AbilityAst`, `TriggerAst`, `ReplacementAst`, `StaticAst` and resolve `SubAbility$ DBname` → link to the named SVar's ability. If the referenced SVar doesn't exist, throw with the referencing line's context.

- [ ] **Step 1: Failing test**

```ts
// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, it, expect } from "vitest";
import { parseCard } from "./assembler.js";

describe("intra-card reference resolution", () => {
  it("links SubAbility\$ to named SVar ability", () => {
    const source = [
      "Name:Mulldrifter",
      "ManaCost:4 U",
      "Types:Creature Elemental",
      "PT:2/2",
      "K:Flying",
      "T:Mode$ ChangesZone | Origin$ Any | Destination$ Battlefield | ValidCard$ Card.Self | Execute$ TrigDraw",
      "SVar:TrigDraw:DB$ Draw | NumCards$ 2",
    ].join("\n") + "\n";
    const card = parseCard(source, "mulldrifter.txt");
    const trig = card.triggers[0]!;
    // The resolver populates effect.subAbility inline (or at least verifies the reference exists)
    expect(card.svars.get("TrigDraw")).toBeDefined();
    expect(trig.effect.handlerKey).toBe("TrigDraw");
  });

  it("throws when SubAbility\$ references unknown SVar", () => {
    const source = [
      "Name:Broken",
      "Types:Instant",
      "A:SP$ DealDamage | Cost$ R | NumDmg$ 1 | ValidTgts$ Any | SubAbility$ DBMissing",
    ].join("\n") + "\n";
    expect(() => parseCard(source, "broken.txt")).toThrow(/unresolved reference 'DBMissing'/);
  });
});
```

- [ ] **Step 2: Implement resolver**

Create `packages/cards/src/parser/resolver.ts`:

```ts
// SPDX-License-Identifier: GPL-3.0-or-later
import type { AbilityAst, CardDefinition, EffectInvocation, ReplacementAst, StaticAst, SVarAst, TriggerAst } from "@mtg-forge-ts/core";

const walkParams = (
  where: string,
  invocation: EffectInvocation,
  svars: ReadonlyMap<string, SVarAst>,
): void => {
  for (const [k, pv] of Object.entries(invocation.params)) {
    if (pv.kind === "svarRef") {
      if (!svars.has(pv.name)) {
        throw new Error(`${where}: param '${k}' unresolved reference '${pv.name}'`);
      }
    }
  }
  // The handlerKey itself may be a reference to an SVar (the common case
  // in Trigger's Execute\$ DBname and Replacement's ReplaceWith\$ DBname).
  if (invocation.handlerKey.startsWith("DB") && svars.has(invocation.handlerKey)) {
    // Reference resolves — good.
  } else if (invocation.handlerKey.startsWith("DB") && !svars.has(invocation.handlerKey)) {
    throw new Error(`${where}: unresolved reference '${invocation.handlerKey}'`);
  }
  if (invocation.subAbility) walkParams(`${where}.subAbility`, invocation.subAbility, svars);
};

export const resolveReferences = (card: CardDefinition): void => {
  const svars = card.svars;
  card.abilities.forEach((a: AbilityAst, i: number) => {
    walkParams(`${card.name}.abilities[${i}]`, a.effect, svars);
  });
  card.triggers.forEach((t: TriggerAst, i: number) => {
    walkParams(`${card.name}.triggers[${i}]`, t.effect, svars);
  });
  card.replacements.forEach((r: ReplacementAst, i: number) => {
    walkParams(`${card.name}.replacements[${i}]`, r.effect, svars);
  });
  // Statics don't have EffectInvocation at the top level; their params
  // may svarRef. Walk them uniformly.
  card.statics.forEach((s: StaticAst, i: number) => {
    for (const [k, pv] of Object.entries(s.params)) {
      if (pv.kind === "svarRef" && !svars.has(pv.name)) {
        throw new Error(`${card.name}.statics[${i}]: param '${k}' unresolved reference '${pv.name}'`);
      }
    }
  });
  card.faces?.forEach(resolveReferences);
};
```

- [ ] **Step 3: Wire into assembler**

In `packages/cards/src/parser/assembler.ts`, at the end of `parseCard`:

```ts
import { resolveReferences } from "./resolver.js";

// ...

export const parseCard = (source: string, file: string): CardDefinition => {
  // ... existing assembly ...
  const result = sections.length === 1 ? primary : { ...primary, faces };
  resolveReferences(result);
  return result;
};
```

- [ ] **Step 4: Run + commit**

```bash
pnpm --filter @mtg-forge-ts/cards test resolver
git add packages/cards/src/parser/resolver.ts packages/cards/src/parser/resolver.test.ts packages/cards/src/parser/assembler.ts
git commit -s -m "feat(cards): resolve SubAbility\$ / SVar\$ references — throw on unresolved"
```

---

### Task 26: Source-location errors with lineNumber + parser index export

**Files:**
- Modify: `packages/cards/src/index.ts` (export `parseCard`, `lex`, line parsers)
- Test: `packages/cards/src/parser/error-messages.test.ts`

- [ ] **Step 1: Failing test — error messages always include file + line**

```ts
// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, it, expect } from "vitest";
import { parseCard } from "./assembler.js";

describe("error messages include source location", () => {
  it("reports line number for unknown keyword", () => {
    const source = [
      "Name:Bogus",
      "Types:Creature Human",
      "K:NotARealKeyword",
    ].join("\n") + "\n";
    expect(() => parseCard(source, "bogus.txt")).toThrow(/line 3/);
  });

  it("reports line number for unknown StaticAbilityMode", () => {
    const source = [
      "Name:Bogus",
      "Types:Enchantment",
      "S:Mode$ NotARealMode",
    ].join("\n") + "\n";
    expect(() => parseCard(source, "bogus.txt")).toThrow(/line 3/);
  });

  it("reports line number for missing SVar reference", () => {
    const source = [
      "Name:Bogus",
      "Types:Instant",
      "A:SP$ DealDamage | Cost$ R | NumDmg$ 1 | ValidTgts$ Any | SubAbility$ DBMissing",
    ].join("\n") + "\n";
    expect(() => parseCard(source, "bogus.txt")).toThrow(/DBMissing/);
  });
});
```

- [ ] **Step 2: Verify and harden error messages**

Walk every `throw` in the parser modules (lexer, per-prefix parsers, resolver, assembler) and confirm the message includes `line ${lineNumber}` OR a card-name path. Fix any that don't. (The existing implementations in Tasks 11–25 already follow this pattern — this task is a verification + hardening pass.)

- [ ] **Step 3: Export public API**

Edit `packages/cards/src/index.ts`:

```ts
// SPDX-License-Identifier: GPL-3.0-or-later
export const CARDS_VERSION = "0.0.0";

export * from "./parser/lexer.js";
export * from "./parser/ability-line.js";
export * from "./parser/colors-line.js";
export * from "./parser/keyword-line.js";
export * from "./parser/mana-cost-line.js";
export * from "./parser/pt-loyalty-defense.js";
export * from "./parser/replacement-line.js";
export * from "./parser/simple-lines.js";
export * from "./parser/static-line.js";
export * from "./parser/svar-line.js";
export * from "./parser/trigger-line.js";
export * from "./parser/type-line.js";
export * from "./parser/assembler.js";
export * from "./parser/resolver.js";
```

- [ ] **Step 4: Run + commit**

```bash
pnpm --filter @mtg-forge-ts/cards test && pnpm --filter @mtg-forge-ts/cards build && pnpm typecheck
git add packages/cards/src/index.ts packages/cards/src/parser/error-messages.test.ts
git commit -s -m "feat(cards): verify source-location errors + export public parser API"
```

---

### M1 gate — parser foundation

- [ ] **Full gate**

```bash
pnpm typecheck && pnpm test && pnpm build && pnpm lint && pnpm lint:determinism
```

Expected: all pass. New test count: 1844 (pre-SP3) + ~20 M0 + ~50 M1 = ~1914.

- [ ] **Golden-master sanity check**

Parse 3 representative Forge vendored card files (if you have them locally at `F:\BACKUP\Programacion\forge\forge-gui\res\cardsfolder\*.txt`). Pick Lightning Bolt, Grizzly Bears, and Counterspell. Confirm each parses without error and produces a non-trivial `CardDefinition`. Add this as a fixture test:

```bash
node -e "
const { parseCard } = require('./packages/cards/dist/index.cjs');
const fs = require('fs');
const src = fs.readFileSync('F:/BACKUP/Programacion/forge/forge-gui/res/cardsfolder/l/lightning_bolt.txt', 'utf8');
console.log(JSON.stringify(parseCard(src, 'lightning_bolt.txt'), null, 2));
"
```

If the parse throws on a real vendored file, **do not ignore**: add the failing shape to the parser tests and fix. This is the first real contact with upstream data — early issues are cheaper to fix than late.

---

## Deferred-items appendix

### Not landed in this plan — follow-up plans required before execution

**SP3 Part B — Structural validator + SVar + CostPart + mana solver** (next plan)
- 3b: Structural validator (dsl-schemas.json, required-params check, SVar reference walk — the structural validator confirms shape before handlers run)
- 3c: SVar evaluator + initial selector set (Count\$, Number\$, PlayerCount\$, SumPower/Toughness/CMC, Targeted\$, arithmetic, LifeTotal\$, XChoice)
- 3e: CostPart hierarchy (~30 classes)
- Mana cost solver (§9 of spec)

**SP3 Part C — Top 30 effects + AltCostRegistry + factory + flagship integration** (after Part B)
- 3f: AltCostRegistry + mainstream alt-costs (Flashback, Madness, Foretell, Bestow, Overload)
- 3h: Top 30 most-common effect handlers (Draw, DealDamage, Destroy, Pump, Counter, Search, Mill, Discard, Exile, ReturnToHand, AddCounter, ChangeZone, Tap, Untap, GainLife, LoseLife, CreateToken, Fight, Scry, etc.)
- §12: Factory dispatch (CardDefinition → live abilities on ETB)
- 3ac: Flagship integration test (Lightning Bolt, Grizzly Bears, Divination, Wrath of God, Cryptic Command end-to-end)

**SP3 Part D+ — Long-tail effect handlers** (fills out 3i–3w)

**SP3 Part E — Trigger handlers (139)** — mechanical, batched dispatch

**SP3 Part F — Replacement handlers (46)** — mechanical

**SP3 Part G — Keyword handlers (34, 7 shapes)**

**SP3 Part H — Semantic validator + full fixture suite + upstream sync**

### Known open issues carried from SP2 Round 1 audit — deferred to SP3+

From `project_mtg_forge_ts_sp1_execution.md` (memory file):

- **A-004**: CastPipeline `Card.face` mutation leaks into hand — needs pipeline refactor
- **I-3**: Commander-to-Command should be a replacement, not an SBA (CR 903.9)
- **I-5**: Layer 7e switch + timestamp sort with null P/T (partial Round 1 fix)
- **I-6**: Replacement orderer single-applicable empty-array branch
- **I-8**: Trigger suppression filter shape (delayed-trigger bypass)
- **I-11**: StaticEffectRegistry vs ContinuousEffectRegistry — source-id tagging
- **I-12**: SBA premature `terminalState=draw` in multi-player
- **I-14**: World-rule uses EntityId as timestamp proxy (wrong after snapshot restore) — fix with `Card.timestamp` in SP3 Part C's factory dispatch
- **I-16**: CDA-first within-layer, not cross-layer (CR 604.3 requires CDAs to feed base BEFORE any layer runs)
- **I-17**: `resolveSourceController` falls back to activePlayer for emblems (should throw)

These don't block Part A. Address opportunistically during Part B+ when the surrounding code is in active edit.

### Stack.copy re-parent concern

From SP2 Round 1 remediation notes: copying a stack item inherits resolver closure via spread. Replay determinism + snapshot Option-A restore diverges. Flagged for SP3 Part C's AbilityRegistry design (registry-backed resolvers with stable ids).

