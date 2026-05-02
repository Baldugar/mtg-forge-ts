# SP3 Part B — Structural Validator + SVar Evaluator Core

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a standalone structural validator over `CardDefinition` (complements per-parser throws with a single `validateCard(def) → ValidationResult` API) and an SVar evaluator that interprets the parser's `SVarExpressionAst` nodes into numeric values or sub-abilities at runtime.

**Architecture:**
- **M2** (structural validator): lives in `@mtg-forge-ts/cards/src/validator/`. Runs AFTER `parseCard` produces a `CardDefinition`. Collects all violations instead of throwing on the first one (unlike parser error surfacing). Checks that need no registry: mana-cost syntactic validity, zone-name validity, SVar selector-kind is in the known set, identifier shape. Per-handler required-params checks deferred to Part H's semantic validator (they need the handler registry).
- **M3** (SVar evaluator): lives in `@mtg-forge-ts/game/src/svar/`. Provides `evaluateSVar(pv: ParamValue, ctx: SvarContext): number | EffectInvocation`. Each selector is a small evaluator class registered in a central registry. Part B lands 10 most-common selectors; ~90 tail selectors deferred to Part B2 or absorbed into later milestones when needed.

**Tech Stack:** unchanged from Part A — TypeScript strict, pnpm workspaces, vitest, fast-check, tsup, biome.

**Non-negotiable invariants (carry forward):**
- Generator-based engine. No Promise/async inside `function*`.
- Three mutators: GameAction / CombatHandler / subsystem-internal.
- Entity-ID refs; deep `readonly` on union variants.
- `kind:` discriminator + `readonly version: 1` on every event; exhaustiveness guards on every `switch (x.kind)`.
- Deterministic Rng only (CI enforced).
- `git commit -s`; no `Co-Authored-By` (user global rule).
- SPDX headers; `.js` imports; `import type`; strict TS flags.
- Forge-fidelity wins over plan.

**Branch:** stay on `sp1-engine-foundations`.

**Pre-plan test count:** 1964 passing (647 core + 1230 game + 87 cards).

---

## Milestone M2 — Structural validator (4 tasks)

### Task 27: ValidationResult type + `validateCard` skeleton

**Files:**
- Create: `packages/cards/src/validator/index.ts`
- Create: `packages/cards/src/validator/validate-card.ts`
- Create: `packages/cards/src/validator/validate-card.test.ts`
- Modify: `packages/cards/src/index.ts` (add export)

**Output shape:**

```ts
export interface ValidationIssue {
  readonly severity: "error" | "warning";
  readonly message: string;
  readonly path: string;
}

export interface ValidationResult {
  readonly ok: boolean;
  readonly issues: readonly ValidationIssue[];
}
```

The skeleton walks a `CardDefinition` (and its `faces`) and collects issues from per-aspect validators that Tasks 28–30 add. The skeleton itself performs no checks — it just wires up the iteration + composition.

- [ ] **Step 1: Failing test**

Create `packages/cards/src/validator/validate-card.test.ts`:

```ts
// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, it, expect } from "vitest";
import { parseCard } from "../parser/assembler.js";
import { validateCard } from "./validate-card.js";

describe("validateCard skeleton", () => {
  it("returns ok: true for a trivially valid card", () => {
    const card = parseCard("Name:Bolt\nManaCost:R\nTypes:Instant\n", "bolt.txt");
    const res = validateCard(card);
    expect(res.ok).toBe(true);
    expect(res.issues).toEqual([]);
  });

  it("descends into faces", () => {
    const src = [
      "Name:A",
      "ManaCost:R",
      "Types:Instant",
      "AlternateMode:Split",
      "Name:B",
      "ManaCost:U",
      "Types:Instant",
    ].join("\n") + "\n";
    const card = parseCard(src, "ab.txt");
    const res = validateCard(card);
    expect(res.ok).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify FAIL**

```bash
pnpm --filter @mtg-forge-ts/cards test validate-card
```

Expected: module not found.

- [ ] **Step 3: Implement `validate-card.ts`**

```ts
// SPDX-License-Identifier: GPL-3.0-or-later
// Structural validator — post-parse check that walks the CardDefinition
// and collects all violations, rather than throwing on the first. Runs
// only checks that do NOT require the handler registry (per-handler
// required-params schemas land in Part H's semantic validator).

import type { CardDefinition } from "@mtg-forge-ts/core";

export interface ValidationIssue {
  readonly severity: "error" | "warning";
  readonly message: string;
  readonly path: string;
}

export interface ValidationResult {
  readonly ok: boolean;
  readonly issues: readonly ValidationIssue[];
}

export type ValidatorFn = (card: CardDefinition, path: string) => readonly ValidationIssue[];

const ALL_VALIDATORS: ValidatorFn[] = [];

export const registerValidator = (fn: ValidatorFn): void => {
  ALL_VALIDATORS.push(fn);
};

export const validateCard = (card: CardDefinition): ValidationResult => {
  const issues: ValidationIssue[] = [];
  const walk = (def: CardDefinition, path: string): void => {
    for (const v of ALL_VALIDATORS) {
      for (const issue of v(def, path)) issues.push(issue);
    }
    def.faces?.forEach((face, i) => {
      walk(face, `${path}.faces[${i}]`);
    });
  };
  walk(card, card.name);
  return { ok: issues.every((i) => i.severity !== "error"), issues };
};
```

- [ ] **Step 4: Create `packages/cards/src/validator/index.ts`**

```ts
// SPDX-License-Identifier: GPL-3.0-or-later
export * from "./validate-card.js";
```

- [ ] **Step 5: Export from cards public API**

Edit `packages/cards/src/index.ts`, add after the parser exports:

```ts
export * from "./validator/index.js";
```

- [ ] **Step 6: Run test + gate**

```bash
pnpm --filter @mtg-forge-ts/cards test validate-card
pnpm typecheck && pnpm test && pnpm build && pnpm lint
```

Expected PASS; +2 new tests (1964 → 1966).

- [ ] **Step 7: Commit**

```bash
git add packages/cards/src/validator packages/cards/src/index.ts
git commit -s -m "feat(cards): structural validator skeleton — validateCard API

Post-parse validator walks CardDefinition + faces and collects issues
from registered per-aspect validators (mana, zones, svar-selectors in
follow-up tasks). Skeleton only — no checks yet."
```

---

### Task 28: Mana-cost validator

**Files:**
- Create: `packages/cards/src/validator/mana-cost-validator.ts`
- Create: `packages/cards/src/validator/mana-cost-validator.test.ts`
- Modify: `packages/cards/src/validator/index.ts` (add export + self-register)

**Logic:** For each `CardDefinition.manaCost` (non-null), re-parse via `ManaCost.parse(raw)` from core. If it throws, emit an error issue. If the cost has suspicious structure (0 symbols but raw !== "no cost" / "0" / ""), emit a warning.

Also walks any inline costs in ability `cost.raw` strings — but those use a different cost grammar (mana + tap + sacrifice etc.), so only validate the mana-symbol subset. Skip for now; revisit in Part C's CostPart hierarchy.

- [ ] **Step 1: Failing test**

```ts
// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, it, expect } from "vitest";
import { parseCard } from "../parser/assembler.js";
import { validateCard } from "./validate-card.js";
import "./mana-cost-validator.js"; // self-registers

describe("mana-cost validator", () => {
  it("accepts valid mana costs", () => {
    const card = parseCard("Name:Bolt\nManaCost:R\nTypes:Instant\n", "bolt.txt");
    expect(validateCard(card).ok).toBe(true);
  });

  it("accepts hybrid mana costs", () => {
    const card = parseCard("Name:Bolt\nManaCost:W/U\nTypes:Instant\n", "bolt.txt");
    expect(validateCard(card).ok).toBe(true);
  });

  it("accepts 'no cost' sentinel", () => {
    const card = parseCard("Name:Morph\nManaCost:no cost\nTypes:Creature\n", "morph.txt");
    expect(validateCard(card).ok).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify FAIL**

- [ ] **Step 3: Implement**

```ts
// SPDX-License-Identifier: GPL-3.0-or-later
import { ManaCost, type CardDefinition, type ManaCostAst } from "@mtg-forge-ts/core";
import { registerValidator, type ValidationIssue } from "./validate-card.js";

const isManaCostAst = (x: unknown): x is ManaCostAst =>
  typeof x === "object" && x !== null && "raw" in x && typeof (x as { raw: unknown }).raw === "string";

const NO_COST = new Set(["no cost", "0", ""]);

const validateManaCost = (card: CardDefinition, path: string): readonly ValidationIssue[] => {
  const issues: ValidationIssue[] = [];
  const mc = card.manaCost;
  if (mc === null || mc === undefined) return issues;
  if (!isManaCostAst(mc)) {
    issues.push({ severity: "error", message: "manaCost is not a ManaCostAst", path });
    return issues;
  }
  if (NO_COST.has(mc.raw.toLowerCase())) return issues;
  try {
    ManaCost.parse(mc.raw);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    issues.push({ severity: "error", message: `invalid mana cost '${mc.raw}': ${msg}`, path: `${path}.manaCost` });
  }
  return issues;
};

registerValidator(validateManaCost);
```

- [ ] **Step 4: Export from index**

```ts
export * from "./mana-cost-validator.js";
```

- [ ] **Step 5: Run + commit**

```bash
git add packages/cards/src/validator/mana-cost-validator.ts packages/cards/src/validator/mana-cost-validator.test.ts packages/cards/src/validator/index.ts
git commit -s -m "feat(cards): validator — mana-cost syntax check via ManaCost.parse"
```

---

### Task 29: Zone-name validator for `S:EffectZone$`

**Files:**
- Create: `packages/cards/src/validator/zone-validator.ts`
- Create: `packages/cards/src/validator/zone-validator.test.ts`
- Modify: `packages/cards/src/validator/index.ts`

**Logic:** For each `StaticAst` in `card.statics`, verify every entry in `activeInZones` is a valid `ZoneType`. Emit an error issue per offender.

Valid zones: read core's `ZoneType` enum. Likely `"Battlefield" | "Hand" | "Library" | "Graveyard" | "Stack" | "Exile" | "Command" | "All"` (PascalCase per the Part A observation). The parser's `parseStaticLine` stores lowercase — so either the validator accepts lowercase OR the parser normalizes to PascalCase. **Decision: validator accepts lowercase** (simpler, matches current parser behavior). When Part C's static effect runtime is wired, it'll normalize as needed.

Check against the set: `{"battlefield","hand","library","graveyard","stack","exile","command","all"}`.

- [ ] **Step 1: Failing test**

```ts
// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, it, expect } from "vitest";
import { parseCard } from "../parser/assembler.js";
import { validateCard } from "./validate-card.js";
import "./zone-validator.js";

describe("zone validator", () => {
  it("accepts default battlefield zone", () => {
    const src = [
      "Name:T",
      "ManaCost:R",
      "Types:Creature Human",
      "S:Mode\$ Continuous | Affected\$ Creature.YouCtrl | AddPower\$ 1 | AddToughness\$ 1",
    ].join("\n") + "\n";
    const card = parseCard(src, "t.txt");
    expect(validateCard(card).ok).toBe(true);
  });

  it("accepts explicit EffectZone\$ All", () => {
    const src = [
      "Name:T",
      "Types:Enchantment",
      "S:Mode\$ CantBeCast | ValidCard\$ Card.Self | EffectZone\$ All",
    ].join("\n") + "\n";
    const card = parseCard(src, "t.txt");
    expect(validateCard(card).ok).toBe(true);
  });

  // The parser currently rejects non-ZoneType names, so this test exercises
  // the validator catching something that slipped past — we simulate by
  // hand-constructing a CardDefinition with an invalid zone.
  it("flags unknown zone names", () => {
    const card = parseCard("Name:T\nTypes:Instant\n", "t.txt");
    const bad = {
      ...card,
      statics: [
        { mode: "Continuous", params: {}, activeInZones: ["valhalla"] },
      ] as unknown as CardDefinition["statics"],
    };
    const res = validateCard(bad as unknown as import("@mtg-forge-ts/core").CardDefinition);
    expect(res.ok).toBe(false);
    expect(res.issues.some((i) => i.message.includes("valhalla"))).toBe(true);
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

- [ ] **Step 3: Implement**

```ts
// SPDX-License-Identifier: GPL-3.0-or-later
import type { CardDefinition, StaticAst } from "@mtg-forge-ts/core";
import { registerValidator, type ValidationIssue } from "./validate-card.js";

const VALID_ZONE_NAMES = new Set([
  "battlefield", "hand", "library", "graveyard", "stack", "exile",
  "command", "all", "sideboard", "ante", "planar", "scheme",
]);

const validateZones = (card: CardDefinition, path: string): readonly ValidationIssue[] => {
  const issues: ValidationIssue[] = [];
  (card.statics as readonly StaticAst[]).forEach((s, i) => {
    s.activeInZones.forEach((zone) => {
      if (!VALID_ZONE_NAMES.has(String(zone).toLowerCase())) {
        issues.push({
          severity: "error",
          message: `unknown zone '${String(zone)}' in S:Mode\$ ${s.mode}`,
          path: `${path}.statics[${i}].activeInZones`,
        });
      }
    });
  });
  return issues;
};

registerValidator(validateZones);
```

- [ ] **Step 4: Export + commit**

```bash
git add packages/cards/src/validator/zone-validator.ts packages/cards/src/validator/zone-validator.test.ts packages/cards/src/validator/index.ts
git commit -s -m "feat(cards): validator — S:EffectZone\$ name check"
```

---

### Task 30: SVar selector-kind registry + selector-name validator

**Files:**
- Create: `packages/cards/src/validator/svar-selector-kinds.ts`
- Create: `packages/cards/src/validator/svar-selector-validator.ts`
- Create: `packages/cards/src/validator/svar-selector-validator.test.ts`
- Modify: `packages/cards/src/validator/index.ts`

**Logic:** The parser emits `SVarExpressionAst` with `kind: string` — e.g. `"Count"`, `"Number"`, `"PlayerCount"`, `"SumPower"`. The validator checks each expression's kind is one of the known selectors.

The registry is a `Set<string>` of known selectors, seeded from Forge's `CardFactoryUtil.java` SVar parsing. We ship a conservative initial set; unknown kinds emit a **warning** (not error) so the validator doesn't block parsing while Part B M3 is expanding the set. When all kinds are covered, switch to error.

Known selectors (initial set; matches M3's evaluator coverage + near-term expansion):

```
Count, Number, PlayerCount, SumPower, SumToughness, SumCMC, Targeted,
LifeTotal, XChoice, X, Amount,
Remembered, RememberedLKI, YouCtrl, YouOwn, OpponentCtrl, OpponentOwn,
Imprinted, Paid, ChosenPlayer, ChosenColor, ChosenType, ChosenNumber,
CardCounters, PlayerCounters, TypeAmount, Valid, DevotionAmount, MetaCount,
Add, Sub, Mul, Div, Mod, Min, Max, Negate, Abs,
TriggerObjects, TriggerPlayer, TriggerCount, TriggerRemembered,
EvokeCost, FlashbackCost, BuybackCost, KickerCost
```

- [ ] **Step 1: Failing test**

```ts
// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, it, expect } from "vitest";
import { parseCard } from "../parser/assembler.js";
import { validateCard } from "./validate-card.js";
import "./svar-selector-validator.js";
import { KNOWN_SVAR_SELECTORS, isKnownSvarSelector } from "./svar-selector-kinds.js";

describe("svar selector validator", () => {
  it("exposes a set of known selectors", () => {
    expect(KNOWN_SVAR_SELECTORS.has("Count")).toBe(true);
    expect(KNOWN_SVAR_SELECTORS.has("Number")).toBe(true);
    expect(isKnownSvarSelector("NotARealKind")).toBe(false);
  });

  it("does not flag known selectors in SVar expressions", () => {
    const src = [
      "Name:Fireball",
      "ManaCost:X R",
      "Types:Sorcery",
      "A:SP\$ DealDamage | Cost\$ X R | NumDmg\$ X | ValidTgts\$ Any",
      "SVar:X:Count\$xPaid",
    ].join("\n") + "\n";
    const card = parseCard(src, "fireball.txt");
    const res = validateCard(card);
    expect(res.ok).toBe(true);
  });

  it("emits a warning for unknown selector kind", () => {
    const src = [
      "Name:Test",
      "Types:Instant",
      "A:SP\$ Draw | Cost\$ U | NumCards\$ 1",
      "SVar:X:NotARealKind\$argx",
    ].join("\n") + "\n";
    const card = parseCard(src, "test.txt");
    const res = validateCard(card);
    expect(res.ok).toBe(true); // warning, not error
    expect(res.issues.some((i) => i.severity === "warning" && i.message.includes("NotARealKind"))).toBe(true);
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

- [ ] **Step 3: Implement `svar-selector-kinds.ts`**

```ts
// SPDX-License-Identifier: GPL-3.0-or-later
// Registry of known SVar selector kinds. Expanded incrementally as the
// SVar evaluator (M3) grows. Unknown kinds emit warnings, not errors —
// the parser doesn't fail on them.

export const KNOWN_SVAR_SELECTORS: ReadonlySet<string> = new Set([
  // Numeric selectors (M3 initial set)
  "Count", "Number", "PlayerCount",
  "SumPower", "SumToughness", "SumCMC",
  "Targeted", "LifeTotal", "XChoice", "X", "Amount",
  // Common object-graph selectors
  "Remembered", "RememberedLKI", "Imprinted", "Paid",
  // Control/ownership
  "YouCtrl", "YouOwn", "OpponentCtrl", "OpponentOwn",
  // Chosen-by-player
  "ChosenPlayer", "ChosenColor", "ChosenType", "ChosenNumber",
  // Counter queries
  "CardCounters", "PlayerCounters",
  // Type / validity
  "TypeAmount", "Valid", "DevotionAmount", "MetaCount",
  // Arithmetic
  "Add", "Sub", "Mul", "Div", "Mod", "Min", "Max", "Negate", "Abs",
  // Trigger context
  "TriggerObjects", "TriggerPlayer", "TriggerCount", "TriggerRemembered",
  // Cost-related (Part C will expand)
  "EvokeCost", "FlashbackCost", "BuybackCost", "KickerCost",
]);

export const isKnownSvarSelector = (kind: string): boolean => KNOWN_SVAR_SELECTORS.has(kind);
```

- [ ] **Step 4: Implement `svar-selector-validator.ts`**

```ts
// SPDX-License-Identifier: GPL-3.0-or-later
import type {
  AbilityAst, CardDefinition, EffectInvocation, ReplacementAst, StaticAst,
  SVarAst, SVarExpressionAst, TriggerAst,
} from "@mtg-forge-ts/core";
import { registerValidator, type ValidationIssue } from "./validate-card.js";
import { isKnownSvarSelector } from "./svar-selector-kinds.js";

const walkExpression = (
  expr: SVarExpressionAst,
  path: string,
  out: ValidationIssue[],
): void => {
  if (!isKnownSvarSelector(expr.kind)) {
    out.push({
      severity: "warning",
      message: `unknown SVar selector kind '${expr.kind}' in '${expr.raw ?? expr.kind}'`,
      path,
    });
  }
  expr.args?.forEach((a, i) => walkExpression(a, `${path}.args[${i}]`, out));
};

const walkInvocation = (inv: EffectInvocation, path: string, out: ValidationIssue[]): void => {
  for (const [k, pv] of Object.entries(inv.params)) {
    if (pv.kind === "expression") {
      walkExpression(pv.ast, `${path}.params.${k}`, out);
    }
  }
  if (inv.subAbility) walkInvocation(inv.subAbility, `${path}.subAbility`, out);
};

const validateSvarSelectors = (card: CardDefinition, path: string): readonly ValidationIssue[] => {
  const issues: ValidationIssue[] = [];
  (card.abilities as readonly AbilityAst[]).forEach((a, i) => {
    walkInvocation(a.effect, `${path}.abilities[${i}]`, issues);
  });
  (card.triggers as readonly TriggerAst[]).forEach((t, i) => {
    walkInvocation(t.effect, `${path}.triggers[${i}]`, issues);
    for (const [k, pv] of Object.entries(t.params)) {
      if (pv.kind === "expression") {
        walkExpression(pv.ast, `${path}.triggers[${i}].params.${k}`, issues);
      }
    }
  });
  (card.replacements as readonly ReplacementAst[]).forEach((r, i) => {
    walkInvocation(r.effect, `${path}.replacements[${i}]`, issues);
    for (const [k, pv] of Object.entries(r.params)) {
      if (pv.kind === "expression") {
        walkExpression(pv.ast, `${path}.replacements[${i}].params.${k}`, issues);
      }
    }
  });
  (card.statics as readonly StaticAst[]).forEach((s, i) => {
    for (const [k, pv] of Object.entries(s.params)) {
      if (pv.kind === "expression") {
        walkExpression(pv.ast, `${path}.statics[${i}].params.${k}`, issues);
      }
    }
  });
  const svars = card.svars as ReadonlyMap<string, SVarAst>;
  for (const [name, sv] of svars) {
    if (sv.expression) {
      walkExpression(sv.expression, `${path}.svars.${name}`, issues);
    }
  }
  return issues;
};

registerValidator(validateSvarSelectors);
```

- [ ] **Step 5: Export + run + commit**

```bash
git add packages/cards/src/validator/svar-selector-kinds.ts packages/cards/src/validator/svar-selector-validator.ts packages/cards/src/validator/svar-selector-validator.test.ts packages/cards/src/validator/index.ts
git commit -s -m "feat(cards): validator — SVar selector-kind registry (warnings for unknown)"
```

---

### M2 gate — validator + golden-master extension

- [ ] **Extend golden-master test** to also run `validateCard` on each Forge card and assert `ok: true`. Edit `packages/cards/test/golden-master.test.ts` (or wherever T26 put it):

```ts
import { validateCard } from "../src/validator/validate-card.js";
import "../src/validator/mana-cost-validator.js";
import "../src/validator/zone-validator.js";
import "../src/validator/svar-selector-validator.js";

// In each maybeParse test:
const card = parseCard(src, relPath);
const res = validateCard(card);
if (!res.ok) console.warn(`validation issues for ${relPath}:`, res.issues);
// Don't fail the test on warnings; just log. Fail on errors:
const errors = res.issues.filter((i) => i.severity === "error");
expect(errors).toEqual([]);
```

- [ ] **Full gate**

```bash
pnpm typecheck && pnpm test && pnpm build && pnpm lint
```

Expected: all green. Test count: 1964 + 2 (T27) + 3 (T28) + 3 (T29) + 3 (T30) ≈ 1975.

---

## Milestone M3 — SVar evaluator + initial selector set (11 tasks)

Evaluator lives in `packages/game/src/svar/` — the evaluator needs the `Game` for world state (life totals, permanents, etc.). Import path: `@mtg-forge-ts/game`.

### Task 31: `SvarContext` + `evaluateSVar` dispatcher

**Files:**
- Create: `packages/game/src/svar/context.ts`
- Create: `packages/game/src/svar/evaluator.ts`
- Create: `packages/game/src/svar/evaluator.test.ts`
- Create: `packages/game/src/svar/selector-registry.ts`
- Modify: `packages/game/src/index.ts` (add export)

**SvarContext shape:**

```ts
import type { EntityId, PlayerSeat, SVarAst } from "@mtg-forge-ts/core";
import type { Game } from "../game.js";

export interface SvarContext {
  readonly game: Game;
  // Source card (or AST-level definition for cards not yet on the battlefield)
  readonly sourceCardId?: EntityId;
  // The current SVar scope — ReadonlyMap<name, SVarAst> — usually the card's own svars
  readonly svars: ReadonlyMap<string, SVarAst>;
  // Controller/active-player context
  readonly controller?: PlayerSeat;
  // Targets for spell/ability evaluation
  readonly targets?: readonly EntityId[];
  // X value (for xPaid in cost-paid selectors)
  readonly xValue?: number;
  // Trigger context for TriggerX selectors
  readonly triggerContext?: {
    readonly objects?: readonly EntityId[];
    readonly player?: PlayerSeat;
    readonly count?: number;
  };
}
```

**Dispatcher:**

```ts
export function evaluateSVar(pv: ParamValue, ctx: SvarContext): number | EffectInvocation {
  switch (pv.kind) {
    case "literal": return parseLiteral(pv.raw);
    case "svarRef": return evaluateSVarByName(pv.name, ctx);
    case "expression": return evaluateExpression(pv.ast, ctx);
  }
}
```

`parseLiteral(raw)`: integer → number; else throws. Non-numeric literal values (e.g. `"Any"` as a target filter) are not numeric SVars — the caller should narrow via a different API.

`evaluateSVarByName(name, ctx)`: looks up `ctx.svars.get(name)`; if `kind === "value"` evaluates the embedded `expression`; if `kind === "ability"` returns the embedded `EffectInvocation` (for DB SVar refs).

`evaluateExpression(ast, ctx)`: dispatches to a registered selector by `ast.kind`. The selector registry is a `Map<string, SelectorFn>` populated by each selector module's self-registration (Tasks 32–41 follow).

### TDD

```ts
// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, it, expect } from "vitest";
import type { SVarAst } from "@mtg-forge-ts/core";
import { evaluateSVar, type SvarContext } from "./evaluator.js";
import { selectorRegistry } from "./selector-registry.js";

const mkCtx = (overrides: Partial<SvarContext> = {}): SvarContext => ({
  game: {} as unknown as SvarContext["game"],
  svars: new Map<string, SVarAst>(),
  ...overrides,
});

describe("evaluateSVar dispatcher", () => {
  it("evaluates literal integer to number", () => {
    expect(evaluateSVar({ kind: "literal", raw: "5" }, mkCtx())).toBe(5);
  });

  it("throws on non-numeric literal in numeric context", () => {
    // Note: the caller distinguishes numeric vs string contexts; the dispatcher
    // throws if the literal is not a number. Caller code that wants a string
    // literal (e.g. "Any" filter) reads pv.raw directly.
    expect(() => evaluateSVar({ kind: "literal", raw: "Any" }, mkCtx())).toThrow(/not a number/);
  });

  it("resolves svarRef by name", () => {
    const svars = new Map<string, SVarAst>([
      ["X", { kind: "value", raw: "Number\$7", expression: { kind: "Number", raw: "Number\$7", args: [] } }],
    ]);
    selectorRegistry.register("Number", (ast) => {
      const arg = ast.args?.[0];
      if (!arg || !arg.raw) return 0;
      return parseInt(arg.raw, 10);
    });
    // Reset after test
    const res = evaluateSVar({ kind: "svarRef", name: "X" }, mkCtx({ svars }));
    expect(res).toBe(7);
  });

  it("throws on unknown expression kind", () => {
    expect(() =>
      evaluateSVar({ kind: "expression", ast: { kind: "NotAKind", raw: "NotAKind\$foo" } }, mkCtx())
    ).toThrow(/unknown SVar selector/);
  });
});
```

- [ ] **Step 1-3: TDD cycle**

Implement:

```ts
// packages/game/src/svar/selector-registry.ts
import type { SVarExpressionAst } from "@mtg-forge-ts/core";
import type { SvarContext } from "./context.js";

export type SelectorFn = (ast: SVarExpressionAst, ctx: SvarContext) => number;

class SelectorRegistry {
  private readonly byKind = new Map<string, SelectorFn>();

  register(kind: string, fn: SelectorFn): void {
    this.byKind.set(kind, fn);
  }

  lookup(kind: string): SelectorFn | undefined {
    return this.byKind.get(kind);
  }
}

export const selectorRegistry = new SelectorRegistry();
```

```ts
// packages/game/src/svar/context.ts
// (paste SvarContext interface from above)
```

```ts
// packages/game/src/svar/evaluator.ts
import type { EffectInvocation, ParamValue, SVarAst, SVarExpressionAst } from "@mtg-forge-ts/core";
import type { SvarContext } from "./context.js";
import { selectorRegistry } from "./selector-registry.js";

const parseLiteralNumber = (raw: string): number => {
  const n = Number(raw);
  if (Number.isNaN(n)) throw new Error(`evaluateSVar: literal '${raw}' not a number`);
  return n;
};

export function evaluateSVar(pv: ParamValue, ctx: SvarContext): number | EffectInvocation {
  switch (pv.kind) {
    case "literal": return parseLiteralNumber(pv.raw);
    case "svarRef": return evaluateSVarByName(pv.name, ctx);
    case "expression": return evaluateExpression(pv.ast, ctx);
  }
}

const evaluateSVarByName = (name: string, ctx: SvarContext): number | EffectInvocation => {
  const sv = ctx.svars.get(name) as SVarAst | undefined;
  if (!sv) throw new Error(`evaluateSVar: unknown SVar '${name}'`);
  if (sv.kind === "ability") {
    if (!sv.ability) throw new Error(`evaluateSVar: ability SVar '${name}' has no ability`);
    return sv.ability;
  }
  // Value form
  if (sv.expression) {
    return evaluateExpression(sv.expression, ctx);
  }
  // Bare raw value (e.g. SVar:X:5)
  return parseLiteralNumber(sv.raw);
};

const evaluateExpression = (ast: SVarExpressionAst, ctx: SvarContext): number => {
  const fn = selectorRegistry.lookup(ast.kind);
  if (!fn) throw new Error(`evaluateSVar: unknown SVar selector '${ast.kind}'`);
  return fn(ast, ctx);
};

export type { SvarContext };
```

Export from `packages/game/src/index.ts`:
```ts
export * from "./svar/index.js";
```
Create `packages/game/src/svar/index.ts`:
```ts
// SPDX-License-Identifier: GPL-3.0-or-later
export * from "./context.js";
export * from "./evaluator.js";
export * from "./selector-registry.js";
```

- [ ] **Commit**

```bash
git add packages/game/src/svar packages/game/src/index.ts
git commit -s -m "feat(game): SVar evaluator dispatcher + selector registry

Dispatcher handles literal/svarRef/expression ParamValue kinds. Selector
registry populated by per-selector modules (Tasks 32-40). evaluateSVar
returns number for numeric selectors OR EffectInvocation for DB-ability
SVars."
```

---

### Task 32: `Number$` selector

**Files:**
- Create: `packages/game/src/svar/selectors/number.ts`
- Create: `packages/game/src/svar/selectors/number.test.ts`

**Logic:** `Number$<integer>` — the arg is a literal number. `Number$5` → 5.

```ts
// SPDX-License-Identifier: GPL-3.0-or-later
import { selectorRegistry } from "../selector-registry.js";

selectorRegistry.register("Number", (ast) => {
  const arg = ast.args?.[0];
  const raw = arg?.raw ?? "";
  const n = Number(raw);
  if (Number.isNaN(n)) {
    throw new Error(`Number\$ selector: '${raw}' is not a number (from '${ast.raw ?? ast.kind}')`);
  }
  return n;
});
```

Test + commit.

---

### Task 33: `X` selector + `XChoice` alias

**Files:** `packages/game/src/svar/selectors/x-choice.ts` + test.

**Logic:** Both `X` and `XChoice` resolve to `ctx.xValue ?? 0`.

```ts
selectorRegistry.register("X", (_ast, ctx) => ctx.xValue ?? 0);
selectorRegistry.register("XChoice", (_ast, ctx) => ctx.xValue ?? 0);
```

Test + commit.

---

### Task 34: `LifeTotal$` selector

**Files:** `selectors/life-total.ts` + test.

**Logic:** `LifeTotal$You` → `ctx.game.players[ctx.controller].life`. `LifeTotal$Opponent` → life of opposing player (for 2-player games). Expand to per-player selectors later.

```ts
selectorRegistry.register("LifeTotal", (ast, ctx) => {
  const scope = ast.args?.[0]?.raw ?? "You";
  const seat = scope.toLowerCase() === "you" || scope.toLowerCase() === "youctrl"
    ? ctx.controller
    : /* opponent */ ctx.controller !== undefined ? (1 - ctx.controller) as PlayerSeat : undefined;
  if (seat === undefined) throw new Error(`LifeTotal\$ selector: no controller in context`);
  const player = ctx.game.getPlayer(seat);
  return player.life;
});
```

(Check core's `Game.getPlayer` API first; adapt signature.)

Test + commit.

---

### Task 35: `PlayerCount$` selector

**Files:** `selectors/player-count.ts` + test.

**Logic:** `PlayerCount$All` → total player count. `PlayerCount$YouCtrl` → 1 (controller only). `PlayerCount$Opponents` → N-1.

```ts
selectorRegistry.register("PlayerCount", (ast, ctx) => {
  const scope = ast.args?.[0]?.raw ?? "All";
  const total = ctx.game.players.length;
  switch (scope.toLowerCase()) {
    case "all": return total;
    case "youctrl":
    case "you": return 1;
    case "opponents": return total - 1;
    default: return total; // fallback
  }
});
```

Test + commit.

---

### Task 36: `Count$` selector (basic forms)

**Files:** `selectors/count.ts` + test.

**Logic:** `Count$xPaid` → `ctx.xValue ?? 0`. `Count$<n>` literal → `n`. Other forms (e.g. `Count$Valid_Creature.YouCtrl`) deferred — emit 0 with warning, or throw with "SVar Count form unsupported" error. For Part B, handle only `xPaid` + literal integer.

```ts
selectorRegistry.register("Count", (ast, ctx) => {
  const arg = ast.args?.[0]?.raw ?? "";
  if (arg === "xPaid") return ctx.xValue ?? 0;
  const n = Number(arg);
  if (!Number.isNaN(n)) return n;
  // Part B tail: unsupported Count form. Emit 0 with caveat.
  throw new Error(`Count\$ selector: unsupported arg '${arg}' (from '${ast.raw ?? ast.kind}')`);
});
```

Test + commit.

---

### Task 37: `SumPower$` / `SumToughness$` / `SumCMC$` selectors

**Files:** `selectors/sum-aggregates.ts` + test.

**Logic:** `SumPower$<valid>` → sum of `power` over cards matching the `<valid>` filter. For Part B, only support `Creature.YouCtrl`, `Creature.OpponentCtrl`, `Creature` (any) — very limited. Full Valid grammar ports in a later plan.

```ts
interface ValidFilter {
  readonly type?: string;
  readonly ctrl?: "you" | "opponent" | "any";
}

const parseValid = (raw: string): ValidFilter => {
  const tokens = raw.split(/\.|\+/);
  let type: string | undefined;
  let ctrl: "you" | "opponent" | "any" | undefined = "any";
  for (const t of tokens) {
    if (t === "YouCtrl") ctrl = "you";
    else if (t === "OpponentCtrl") ctrl = "opponent";
    else type = t;
  }
  return { ...(type ? { type } : {}), ctrl };
};

const sumOverCards = (ctx: SvarContext, filter: ValidFilter, field: "power" | "toughness" | "cmc"): number => {
  let sum = 0;
  for (const card of ctx.game.cards.values()) {
    if (filter.type && !card.types.types.includes(filter.type)) continue;
    if (filter.ctrl === "you" && card.controllerSeat !== ctx.controller) continue;
    if (filter.ctrl === "opponent" && card.controllerSeat === ctx.controller) continue;
    // Simplified: assume all creatures have numeric power/toughness.
    // CR 208.2 allows */X/1+* — parse defensively, skip if non-numeric.
    const v = Number((card as unknown as Record<string, unknown>)[field] ?? 0);
    if (!Number.isNaN(v)) sum += v;
  }
  return sum;
};

selectorRegistry.register("SumPower", (ast, ctx) => {
  const filter = parseValid(ast.args?.[0]?.raw ?? "");
  return sumOverCards(ctx, filter, "power");
});
selectorRegistry.register("SumToughness", (ast, ctx) => {
  const filter = parseValid(ast.args?.[0]?.raw ?? "");
  return sumOverCards(ctx, filter, "toughness");
});
selectorRegistry.register("SumCMC", (ast, ctx) => {
  const filter = parseValid(ast.args?.[0]?.raw ?? "");
  return sumOverCards(ctx, filter, "cmc");
});
```

(Check `Game.cards` API + Card shape first; adapt field access. Card.controllerSeat is per current code. Card.power/toughness may be on a different path — may need to read effective P/T through LayerEngine. Defer if too complex; fallback to base P/T.)

Test + commit.

---

### Task 38: `Targeted$` selector

**Files:** `selectors/targeted.ts` + test.

**Logic:** `Targeted$0` → first target's id, `Targeted$1` → second, etc. Returns the EntityId as a number (EntityId is numeric in core). If out of range → throw.

```ts
selectorRegistry.register("Targeted", (ast, ctx) => {
  const idx = Number(ast.args?.[0]?.raw ?? "0");
  if (!ctx.targets || idx >= ctx.targets.length) {
    throw new Error(`Targeted\$ selector: no target at index ${idx}`);
  }
  return ctx.targets[idx] as unknown as number;
});
```

Note: `EntityId` is a branded number. The cast is intentional — callers consuming the return value use it as an id.

Test + commit.

---

### Task 39: Arithmetic selectors (`Add`, `Sub`, `Mul`, `Div`, `Mod`, `Min`, `Max`, `Negate`, `Abs`)

**Files:** `selectors/arithmetic.ts` + test.

**Logic:** Unary/binary on nested args (each arg is itself a literal number or a nested expression that resolves to a number).

```ts
const evalArg = (arg: SVarExpressionAst | undefined, ctx: SvarContext): number => {
  if (!arg) throw new Error("arithmetic: missing arg");
  // If arg is a nested expression, recurse; if literal-raw, parse as number.
  if (arg.kind === "literal") return Number(arg.raw);
  const fn = selectorRegistry.lookup(arg.kind);
  if (!fn) return Number(arg.raw); // best-effort: treat as literal
  return fn(arg, ctx);
};

selectorRegistry.register("Add", (ast, ctx) => {
  let sum = 0;
  for (const a of ast.args ?? []) sum += evalArg(a, ctx);
  return sum;
});
selectorRegistry.register("Sub", (ast, ctx) => {
  const [a, b] = ast.args ?? [];
  return evalArg(a, ctx) - evalArg(b, ctx);
});
// ... Mul, Div, Mod, Min, Max, Negate (unary), Abs (unary)
```

Test + commit.

---

### Task 40: DB-ability SVar resolution — `evaluateSVarAsAbility`

**Files:** `packages/game/src/svar/ability-eval.ts` + test.

**Logic:** Helper `evaluateSVarAsAbility(name: string, ctx: SvarContext): EffectInvocation` — looks up an ability-form SVar and returns its `EffectInvocation`. Throws if the SVar is value-form. Use case: `Execute$ TrigDraw` in a trigger needs to dispatch the sub-ability.

```ts
// SPDX-License-Identifier: GPL-3.0-or-later
import type { EffectInvocation, SVarAst } from "@mtg-forge-ts/core";
import type { SvarContext } from "./context.js";

export const evaluateSVarAsAbility = (name: string, ctx: SvarContext): EffectInvocation => {
  const sv = ctx.svars.get(name) as SVarAst | undefined;
  if (!sv) throw new Error(`evaluateSVarAsAbility: unknown SVar '${name}'`);
  if (sv.kind !== "ability") {
    throw new Error(`evaluateSVarAsAbility: SVar '${name}' is value-form, not ability`);
  }
  if (!sv.ability) throw new Error(`evaluateSVarAsAbility: '${name}' ability missing`);
  return sv.ability;
};
```

Test + commit.

---

### Task 41: Integration — evaluator end-to-end against parser output

**Files:** `packages/game/src/svar/integration.test.ts`

**Logic:** Parse a real card (Fireball: `SVar:X:Count$xPaid`, `NumDmg$ X`), set `ctx.xValue = 3`, evaluate `NumDmg` param, assert `3`.

```ts
// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, it, expect } from "vitest";
import { parseCard, type CardDefinition } from "@mtg-forge-ts/cards";
import { evaluateSVar } from "./evaluator.js";
import type { SvarContext } from "./context.js";
import "./selectors/number.js";
import "./selectors/x-choice.js";
import "./selectors/count.js";

describe("SVar evaluator integration", () => {
  it("resolves Fireball's NumDmg via Count\$xPaid", () => {
    const src = [
      "Name:Fireball",
      "ManaCost:X R",
      "Types:Sorcery",
      "A:SP\$ DealDamage | Cost\$ X R | NumDmg\$ X | ValidTgts\$ Any",
      "SVar:X:Count\$xPaid",
    ].join("\n") + "\n";
    const card = parseCard(src, "fireball.txt") as CardDefinition;
    const ability = (card.abilities[0] as { effect: { params: Record<string, unknown> } }).effect;
    const numDmg = ability.params["NumDmg"] as Parameters<typeof evaluateSVar>[0];
    const svars = card.svars as unknown as SvarContext["svars"];
    const ctx: SvarContext = {
      game: {} as unknown as SvarContext["game"],
      svars,
      xValue: 3,
    };
    expect(evaluateSVar(numDmg, ctx)).toBe(3);
  });
});
```

Commit.

---

### M3 gate

Full repo test + gate:

```bash
pnpm typecheck && pnpm test && pnpm build && pnpm lint && pnpm lint:determinism
```

Expected: all green; test count up ~15 from M3 tasks.

---

## Deferred to later parts

### Still coming (Part C → Part H)

- **Part C**: CostPart hierarchy + mana cost solver + AltCostRegistry + top-30 effect handlers + factory dispatch
- **Part D**: Extended effect handlers
- **Part E**: Trigger handlers (139)
- **Part F**: Replacement handlers (46)
- **Part G**: Keyword handlers (34)
- **Part H**: Full semantic validator + fixture suite + upstream sync

### SVar tail (~90 more selectors)

The initial 10 selectors here cover the most common cases (Count\$xPaid, Number\$N, X, LifeTotal, PlayerCount, Targeted, arithmetic, SumPower/Toughness/CMC). Forge's CardFactoryUtil.java has ~100 selector kinds total including:
- Full `Valid` grammar (CardState filters: zone, color, counter, tapped, etc.)
- `Remembered` / `RememberedLKI` object-graph walks
- `Chosen*` selectors (player/color/type/number chosen by an earlier decision)
- Trigger-context selectors (TriggerCount, TriggerObjects, etc.)
- Cost selectors (EvokeCost, KickerCost, etc.)

These land opportunistically as specific effect handlers in Part D+ need them.

### Per-handler required-params schemas (semantic validator, Part H)

The structural validator here is intentionally thin. A full dsl-schemas.json with required params per handler lands in Part H alongside the handler registry. Until then, missing-required-param errors surface at runtime when the effect tries to read the param.
