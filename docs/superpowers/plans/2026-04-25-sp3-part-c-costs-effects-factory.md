# SP3 Part C — CostParts + Mana Solver + Effect Registry + Factory + Flagship Integration

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Land the runtime spine that turns parsed `CardDefinition` ASTs into playable cards. After this plan, Lightning Bolt can be cast + paid-for + resolved end-to-end through the real pipeline — parser → factory → cast-pipeline → mana-cost-solver → effect handler → damage event.

**Architecture:**
- **M4**: Minimal CostPart hierarchy. A `CostPart` interface plus concrete classes (CostMana, CostTap, CostSacrifice, CostPayLife). A `CostPayment` orchestrator that runs them in order inside CastPipeline's `stepPayCosts` (replacing SP2's receipt-only stub).
- **M5**: Minimal mana cost solver. Given a `ManaCost` and a `ManaPool`, produce a payment plan consuming mana with hybrid/generic/X resolution. Cost reductions via static abilities **stubbed** (returns cost unchanged) — full `CostAdjustment` lands later.
- **M6**: `SpellAbilityEffect` abstract base + `EffectRegistry` + `SpellAbility` runtime class (wraps `AbilityAst` with bound source card and owner context; provides the `StackItemResolver` that `resolveStackItem` drives).
- **M7**: 5 flagship effect handlers (DealDamage, Draw, Destroy, GainLife, LoseLife) — enough to make Lightning Bolt, Divination, Doom Blade, Healing Salve, Lava Spike playable.
- **M8**: Factory dispatch. `Card.activateAbilitiesFromDefinition()` walks `CardDefinition.abilities` and constructs live `SpellAbility` instances. Wire into `CastPipeline.finalizeStackItem` so the stack item gets a real resolver (no more `null`).
- **M9**: Flagship integration tests. Parse → build → cast → resolve Lightning Bolt end-to-end against a minimal 2-player Game. Verify damage event fires, life total drops.

**Non-negotiables** (carry forward): generator engine, three mutators, entity-ID refs, readonly unions, 94 event kinds + `version:1` discriminator, deterministic Rng, SPDX headers, `.js` imports, `import type`, `git commit -s`, no `Co-Authored-By`, Forge-fidelity wins over plan.

**Pre-plan test count:** 2017 (647 core + 1271 game + 99 cards).

**Branch:** stay on `sp1-engine-foundations`.

---

## Milestone M4 — Minimal CostPart hierarchy (4 tasks)

Lives in `packages/game/src/cost/parts/` (alongside existing SP1 mana cost types).

### Task 42: `CostPart` interface + registry

**Files:**
- Create: `packages/game/src/cost/parts/cost-part.ts`
- Create: `packages/game/src/cost/parts/cost-part-registry.ts`
- Create: `packages/game/src/cost/parts/cost-part.test.ts`
- Create: `packages/game/src/cost/parts/index.ts`
- Modify: `packages/game/src/index.ts` (add export)

**Design:**

```ts
// cost-part.ts
import type { EntityId, PlayerSeat } from "@mtg-forge-ts/core";
import type { EngineYield } from "../../action/engine-yield.js";
import type { Game } from "../../game.js";

export interface CostPaymentContext {
  readonly game: Game;
  readonly payerSeat: PlayerSeat;
  readonly sourceCardId: EntityId;
  readonly raw: string;       // the cost token ("R", "T", "2 life", "Sac Creature", ...)
}

export interface CostPartReceipt {
  readonly handlerKey: string;
  readonly raw: string;
  readonly payload: unknown;   // per-class payload (mana consumed, tapped id, sacrificed id, life paid)
}

export interface CostPart {
  readonly handlerKey: string;
  canPay(ctx: CostPaymentContext): boolean;
  pay(ctx: CostPaymentContext): Generator<EngineYield, CostPartReceipt, unknown>;
  undo(receipt: CostPartReceipt, ctx: CostPaymentContext): void;
}
```

```ts
// cost-part-registry.ts
import type { CostPart } from "./cost-part.js";

class CostPartRegistry {
  private readonly byKey = new Map<string, CostPart>();
  register(part: CostPart): void { this.byKey.set(part.handlerKey, part); }
  lookup(key: string): CostPart | undefined { return this.byKey.get(key); }
}
export const costPartRegistry = new CostPartRegistry();
```

Smoke test: registry round-trip (register fake CostPart, lookup returns it).

Commit: `feat(game): CostPart interface + registry`

---

### Task 43: `CostMana`

**Files:**
- Create: `packages/game/src/cost/parts/cost-mana.ts`
- Create: `packages/game/src/cost/parts/cost-mana.test.ts`

**Logic:** parses a mana-cost raw string via `ManaCost.parse`, calls the (M5) mana cost solver to consume from the payer's `ManaPool`. For M4, the solver is stubbed — just decrement total mana available by the cost's CMC without discriminating by color. M5 replaces with the real solver.

```ts
// SPDX-License-Identifier: GPL-3.0-or-later
import { ManaCost } from "@mtg-forge-ts/core";
import type { CostPart, CostPartReceipt, CostPaymentContext } from "./cost-part.js";
import { costPartRegistry } from "./cost-part-registry.js";

export const CostMana: CostPart = {
  handlerKey: "Mana",
  canPay(ctx) {
    const cost = ManaCost.parse(ctx.raw);
    const player = ctx.game.getPlayer(ctx.payerSeat);
    // M4 stub: compare available mana total to cost's CMC. M5 replaces
    // with real color-aware constraint satisfaction.
    const avail = player.manaPool.totalAmount?.() ?? 0;
    return avail >= cost.cmc;
  },
  *pay(ctx) {
    const cost = ManaCost.parse(ctx.raw);
    const player = ctx.game.getPlayer(ctx.payerSeat);
    // M4 stub: drain CMC worth of mana from pool. M5 replaces.
    const consumed = player.manaPool.drain?.(cost.cmc) ?? 0;
    if (consumed < cost.cmc) {
      throw new Error(`CostMana.pay: insufficient mana (need ${cost.cmc}, got ${consumed})`);
    }
    return {
      handlerKey: "Mana",
      raw: ctx.raw,
      payload: { cmc: cost.cmc, consumed },
    };
  },
  undo(receipt, ctx) {
    const cmc = (receipt.payload as { cmc: number }).cmc;
    const player = ctx.game.getPlayer(ctx.payerSeat);
    player.manaPool.refund?.(cmc);
  },
};

costPartRegistry.register(CostMana);
```

**Note:** `ManaPool.totalAmount / drain / refund` methods may not exist — check `packages/game/src/mana/mana-pool.ts`. If not, add minimal methods OR use existing API. If the existing API is `.add(symbol)` / `.take(symbol)`, adapt.

Test: pay with sufficient mana (success), pay with insufficient mana (throws), undo refunds.

Commit: `feat(game): CostMana — mana-cost payment (M4 stub; M5 wires solver)`

---

### Task 44: `CostTap`

**Files:** `cost-tap.ts` + test.

Tapping cost: "T" token — the source card must be untapped and becomes tapped. Receipt records the card id for undo.

```ts
export const CostTap: CostPart = {
  handlerKey: "Tap",
  canPay(ctx) {
    const card = ctx.game.cards.get(ctx.sourceCardId);
    return !!card && !card.tapped;
  },
  *pay(ctx) {
    const card = ctx.game.cards.get(ctx.sourceCardId);
    if (!card) throw new Error(`CostTap.pay: no card ${ctx.sourceCardId}`);
    if (card.tapped) throw new Error(`CostTap.pay: ${ctx.sourceCardId} already tapped`);
    yield* ctx.game.action.tap(ctx.sourceCardId);
    return { handlerKey: "Tap", raw: ctx.raw, payload: { cardId: ctx.sourceCardId } };
  },
  undo(receipt, ctx) {
    const { cardId } = receipt.payload as { cardId: number };
    // Direct untap bypassing action layer (rollback shouldn't generate events).
    const card = ctx.game.cards.get(cardId);
    if (card) card.tapped = false;
  },
};
costPartRegistry.register(CostTap);
```

Test + commit.

---

### Task 45: `CostPayLife` + `CostSacrifice` + orchestrator

**Files:** `cost-pay-life.ts`, `cost-sacrifice.ts`, `cost-payment.ts` + tests.

**CostPayLife:** "N life" syntax. Player pays N life.
```ts
canPay: life >= N
pay: game.action.changeLife(seat, -N, "cost")
undo: game.action.changeLife(seat, +N, "undo-cost")
```

**CostSacrifice:** "Sac <filter>" syntax. Player selects a controlled permanent matching the filter, sacrifices it. For M4, only support "Sac Creature" — the full filter grammar is Part D.

**CostPayment orchestrator** (`cost-payment.ts`): given a `CostAst.raw` cost string like `"R"` or `"T, Sac Creature"` or `"2 R, Pay 3 life"`, split it into component parts + dispatch each to the right `CostPart`.

**Parser of combined cost string:** split on `,` (respect escapes), trim each. Each segment becomes a `(handlerKey, raw)` pair:
- Bare mana symbols (`R`, `2 R`, `X`) → CostMana
- `"T"` literal → CostTap
- `"N life"` (numeric + `life`) → CostPayLife
- `"Sac <filter>"` → CostSacrifice
- Anything else → throw "unsupported cost form '...' — deferred to Part D"

```ts
// cost-payment.ts
export interface CostPlan {
  readonly parts: readonly { readonly handlerKey: string; readonly raw: string }[];
}

const MANA_SYMBOL_RE = /^[0-9XYZWUBRGCS/\s]+$/;
const LIFE_RE = /^(\d+)\s+life$/i;
const SAC_RE = /^sac\s+(.+)$/i;

export const parseCostString = (raw: string): CostPlan => {
  const segments = raw.split(",").map((s) => s.trim()).filter((s) => s !== "");
  const parts: { handlerKey: string; raw: string }[] = [];
  for (const seg of segments) {
    if (seg === "T") { parts.push({ handlerKey: "Tap", raw: seg }); continue; }
    if (seg === "Q") { parts.push({ handlerKey: "Untap", raw: seg }); continue; }
    if (LIFE_RE.test(seg)) { parts.push({ handlerKey: "PayLife", raw: seg }); continue; }
    if (SAC_RE.test(seg)) { parts.push({ handlerKey: "Sacrifice", raw: seg }); continue; }
    if (MANA_SYMBOL_RE.test(seg)) { parts.push({ handlerKey: "Mana", raw: seg }); continue; }
    throw new Error(`parseCostString: unsupported cost segment '${seg}' (deferred to Part D)`);
  }
  return { parts };
};

export function* payCost(
  plan: CostPlan,
  ctx: CostPaymentContext,
): Generator<EngineYield, readonly CostPartReceipt[], unknown> {
  const receipts: CostPartReceipt[] = [];
  for (const { handlerKey, raw } of plan.parts) {
    const part = costPartRegistry.lookup(handlerKey);
    if (!part) throw new Error(`payCost: no handler '${handlerKey}'`);
    const partCtx: CostPaymentContext = { ...ctx, raw };
    const receipt = yield* part.pay(partCtx);
    receipts.push(receipt);
  }
  return receipts;
}

export function undoCost(
  receipts: readonly CostPartReceipt[],
  ctx: CostPaymentContext,
): void {
  // LIFO rollback
  for (let i = receipts.length - 1; i >= 0; i--) {
    const r = receipts[i];
    if (!r) continue;
    const part = costPartRegistry.lookup(r.handlerKey);
    if (part) part.undo(r, { ...ctx, raw: r.raw });
  }
}
```

Tests: pay `R, T, 2 life` combined (3 parts); undo rolls back in LIFO. Commit.

---

## Milestone M5 — Minimal mana cost solver (4 tasks)

Replaces M4's CostMana stub (`totalAmount`/`drain`) with a real color-aware solver. Lives in `packages/game/src/mana/solver/`.

### Task 46: `ManaCostBeingPaid` tracker

**Files:** `packages/game/src/mana/solver/mana-cost-being-paid.ts` + test.

**Logic:** a mutable view of remaining mana to pay. Accepts a `ManaCost` at construction, exposes `canConsume(symbol)`, `consume(symbol)`, `isPaid()`. Handles hybrid (2 hybrid W/U means either W or U satisfies), phyrexian (P/W means pay either W OR 2 life — life option handled by solver, not here), generic (needs any non-snow mana), X (needs N of any to be bound later).

```ts
// Minimal version for M5 — hybrid/generic/X; phyrexian-as-W and snow treated as normal colored.
export class ManaCostBeingPaid {
  // ... internal counters per pip type ...
  canConsume(symbol: ManaSymbol): boolean { /* ... */ }
  consume(symbol: ManaSymbol): void { /* ... */ }
  isPaid(): boolean { /* ... */ }
  remainingCmc(): number { /* ... */ }
}
```

Use the existing `ManaCost` class from core for structure. Peek at `packages/core/src/mana/cost.ts` to understand its ManaCost.symbols shape. Build ManaCostBeingPaid on top.

Test:
- Construct from `ManaCost.parse("R")`, consume "R", isPaid === true
- Construct from `ManaCost.parse("1 R")`, consume "R" (colored first), consume "G" (generic), isPaid === true
- Construct from `"W/U"`, consume "W" isPaid, or consume "U" isPaid
- Construct from `"X R"` with X=2, consume 3 of any → isPaid

Commit.

---

### Task 47: Payment plan builder — pure

**Files:** `packages/game/src/mana/solver/solver.ts` + test.

**Logic:** given `ManaCost` + available `ManaPool`, produce a payment plan (ordered list of `(source, symbol)` pairs drained from the pool) OR `null` if unpayable. Handles:
- Required colors paid from matching-color mana first
- Hybrid — pick cheapest-available color
- Generic — any mana, prefer uncolored over colored (leave colored for later costs)
- X — bound from decision input (pass `xValue` argument)
- Phyrexian — try colored mana first; if unavailable, offer life payment option (returned as a flag on the plan)

For M5 MVP: don't optimize. Greedy algorithm:
1. Sort mana-cost pips into: required-color, hybrid, phyrexian, generic, X.
2. For each required-color pip: consume from pool in that color; if unavailable → return null.
3. For each hybrid: consume from any of its colors with available mana; if none → null.
4. For each phyrexian: prefer colored; else mark for life payment.
5. For generics + X: consume any remaining mana in priority (colorless → colored that still has surplus).
6. Return plan or null.

```ts
export interface ManaPaymentPlan {
  readonly consumed: readonly { readonly symbol: string; readonly source: "pool" | "life" }[];
  readonly lifePaid: number;
}

export const solveManaPayment = (
  cost: ManaCost,
  pool: ManaPool,
  options?: { readonly xValue?: number },
): ManaPaymentPlan | null => {
  // ... greedy implementation ...
};
```

Test cases:
- Pay R from pool with one R → plan has one `{symbol: "R", source: "pool"}`, life 0
- Pay R from pool with only G → null
- Pay 2 from pool with 2 G → plan uses G for generic
- Pay W/U from pool with only U → plan uses U
- Pay P/W from pool with no mana → plan with life 2

Commit.

---

### Task 48: Pool-consume apply + M4 CostMana upgrade

**Files:**
- Modify: `packages/game/src/cost/parts/cost-mana.ts`
- Create: `packages/game/src/mana/solver/apply-plan.ts`

**Logic:** apply a `ManaPaymentPlan` by actually removing mana from the pool + deducting life if needed. Wire this into CostMana.pay (replacing M4's stub).

```ts
export function* applyPaymentPlan(
  plan: ManaPaymentPlan,
  ctx: CostPaymentContext,
): Generator<EngineYield, void, unknown> {
  const player = ctx.game.getPlayer(ctx.payerSeat);
  for (const entry of plan.consumed) {
    if (entry.source === "pool") {
      player.manaPool.remove(entry.symbol); // adapt to actual API
    }
  }
  if (plan.lifePaid > 0) {
    yield* ctx.game.action.changeLife(ctx.payerSeat, -plan.lifePaid, "phyrexian");
  }
}
```

Update CostMana.canPay/pay/undo to use solver output instead of CMC-only stub. Undo records the plan and refunds.

Tests verifying solver-backed CostMana pays `"R"` correctly, fails on `"U"` when only R available, pays phyrexian with life.

Commit.

---

### Task 49: X-cost plumbing

**Files:** `packages/game/src/mana/solver/x-cost.ts` + test.

**Logic:** when cost contains X, the payer chooses X. For cast-pipeline integration, X is a decision yield (`kind: "chooseX"`, request: `{minX, maxX}`). Solver returns a plan bound to a given X value; caller resolves X first.

For M5 MVP: expose `chooseXValue(ctx): number` as a generator that yields the decision + returns the chosen X. Default max is bounded by available mana. Called by CostMana before solveManaPayment.

Test with a scripted controller choosing X=2.

Commit.

---

## Milestone M6 — Effect framework (3 tasks)

Lives in `packages/game/src/ability/`.

### Task 50: `SpellAbilityEffect` abstract base + `EffectRegistry`

**Files:**
- Create: `packages/game/src/ability/spell-ability-effect.ts`
- Create: `packages/game/src/ability/effect-registry.ts`
- Create: `packages/game/src/ability/spell-ability-effect.test.ts`
- Create: `packages/game/src/ability/index.ts`
- Modify: `packages/game/src/index.ts`

**Design:**

```ts
// spell-ability-effect.ts
import type { EngineYield } from "../action/engine-yield.js";
import type { Game } from "../game.js";
import type { SpellAbility } from "./spell-ability.js";

export abstract class SpellAbilityEffect {
  static readonly handlerKey: string;
  abstract resolve(sa: SpellAbility, game: Game): Generator<EngineYield, void, unknown>;
  /** Optional rules-text override. Default reads from ast params' SpellDescription. */
  getStackDescription?(sa: SpellAbility): string;
}
```

```ts
// effect-registry.ts
type EffectClass = new () => SpellAbilityEffect;
type EffectCtorLike = { handlerKey: string; new (): SpellAbilityEffect };

class EffectRegistry {
  private readonly byKey = new Map<string, EffectCtorLike>();
  register(cls: EffectCtorLike): void { this.byKey.set(cls.handlerKey, cls); }
  lookup(key: string): EffectCtorLike | undefined { return this.byKey.get(key); }
  has(key: string): boolean { return this.byKey.has(key); }
}
export const effectRegistry = new EffectRegistry();
```

Test: register a fake Effect subclass, lookup returns it, constructing it yields an instance with `.resolve`.

Commit.

---

### Task 51: `SpellAbility` runtime class

**Files:**
- Create: `packages/game/src/ability/spell-ability.ts`
- Create: `packages/game/src/ability/spell-ability.test.ts`

**Design:**

```ts
// SpellAbility binds a parsed AbilityAst to a specific source card at
// runtime. It's the abstraction the CastPipeline hands to resolve-time
// code; it carries the AST params, source card id, casting player, and
// selected targets.

export class SpellAbility {
  constructor(
    readonly ast: AbilityAst,
    readonly sourceCardId: EntityId,
    readonly controllerSeat: PlayerSeat,
    readonly targets: readonly EntityId[] = [],
    readonly xValue?: number,
  ) {}

  get handlerKey(): string { return this.ast.effect.handlerKey; }

  /** Build a StackItemResolver that drives the registered effect's resolve(). */
  makeResolver(): StackItemResolver {
    const sa = this;
    return {
      *resolve(gameUnknown: unknown): Generator<unknown, void, unknown> {
        const game = gameUnknown as Game;
        const cls = effectRegistry.lookup(sa.handlerKey);
        if (!cls) throw new Error(`SpellAbility: no registered effect for '${sa.handlerKey}'`);
        const effect = new cls();
        yield* effect.resolve(sa, game);
      },
    };
  }
}
```

Test: create SpellAbility wrapping a DealDamage-like AST (registered as a fake effect), call makeResolver, drive generator → verify the effect.resolve was called with sa+game.

Commit.

---

### Task 52: Effect param evaluation helper

**Files:** `packages/game/src/ability/evaluate-param.ts` + test.

**Logic:** convenience wrapper — given a SpellAbility + a param key, evaluate its ParamValue via the SVar evaluator and return a number (or throw). Also `evaluateParamRaw(sa, key): string` for string-form params (Valid filters, zone names).

```ts
export const evaluateParamNumber = (sa: SpellAbility, key: string, game: Game): number => {
  const pv = sa.ast.effect.params[key];
  if (!pv) throw new Error(`evaluateParamNumber: no param '${key}' on ${sa.handlerKey}`);
  const ctx: SvarContext = {
    game,
    sourceCardId: sa.sourceCardId,
    svars: /* from source card's CardDefinition */ new Map(),
    controller: sa.controllerSeat,
    targets: sa.targets,
    xValue: sa.xValue,
  };
  const result = evaluateSVar(pv, ctx);
  if (typeof result !== "number") {
    throw new Error(`evaluateParamNumber: param '${key}' evaluated to non-number`);
  }
  return result;
};

export const evaluateParamRaw = (sa: SpellAbility, key: string): string => {
  const pv = sa.ast.effect.params[key];
  if (!pv) throw new Error(`evaluateParamRaw: no param '${key}' on ${sa.handlerKey}`);
  if (pv.kind === "literal") return pv.raw;
  throw new Error(`evaluateParamRaw: param '${key}' is not literal (kind=${pv.kind})`);
};
```

**Note on svars field:** SpellAbility doesn't currently carry the source card's svars map. Two options:
1. Add `svars: ReadonlyMap<string, SVarAst>` to SpellAbility constructor.
2. Look up svars via `game.cards.get(sa.sourceCardId)?.paperCard.definition.svars`.

Option 1 is cleaner (no Game round-trip); take it.

Test: DealDamage ast with `NumDmg$ 3`, evaluateParamNumber returns 3. With `NumDmg$ X` and xValue=2, returns 2.

Commit.

---

## Milestone M7 — First effect handlers (5 tasks)

Lives in `packages/game/src/ability/effects/`. Each is a standalone class self-registering via `effectRegistry.register(X)` at module load.

### Task 53: `DealDamageEffect`

**Files:** `effects/deal-damage.ts` + test.

**Logic:** `SP$ DealDamage | NumDmg$ N | ValidTgts$ ...`. Read NumDmg via SVar evaluator. For each target in `sa.targets`, emit damage via `game.action.damage(source, targetKind, targetId, amount, isCombat=false)`.

```ts
import type { EntityId } from "@mtg-forge-ts/core";
import { SpellAbilityEffect } from "../spell-ability-effect.js";
import { effectRegistry } from "../effect-registry.js";
import { evaluateParamNumber } from "../evaluate-param.js";

export class DealDamageEffect extends SpellAbilityEffect {
  static readonly handlerKey = "DealDamage";
  override *resolve(sa: SpellAbility, game: Game): Generator<EngineYield, void, unknown> {
    const amount = evaluateParamNumber(sa, "NumDmg", game);
    for (const targetId of sa.targets) {
      const target = game.cards.get(targetId) ?? null;
      const targetKind = target ? "creature" as const : "player" as const;
      yield* game.action.damage(sa.sourceCardId, targetKind, targetId, amount, false);
    }
  }
}

effectRegistry.register(DealDamageEffect);
```

Test: cast a DealDamage sa targeting a player, verify life decreases by NumDmg.

Commit.

---

### Task 54: `DrawEffect`

**Files:** `effects/draw.ts` + test.

```ts
export class DrawEffect extends SpellAbilityEffect {
  static readonly handlerKey = "Draw";
  override *resolve(sa, game) {
    const n = evaluateParamNumber(sa, "NumCards", game);
    for (const seat of targetPlayers(sa)) {
      yield* game.action.drawCards(seat, n);
    }
  }
}
```

`targetPlayers(sa)`: reads `Defined$` param or defaults to `controllerSeat`. For M7 MVP, default to controller.

Test: Divination (draw 2) → controller's hand grows by 2. Commit.

---

### Task 55: `DestroyEffect`

**Files:** `effects/destroy.ts` + test.

```ts
export class DestroyEffect extends SpellAbilityEffect {
  static readonly handlerKey = "Destroy";
  override *resolve(sa, game) {
    for (const targetId of sa.targets) {
      yield* game.action.destroy(targetId, { sourceId: sa.sourceCardId, cause: "effect" });
    }
  }
}
```

Test: Doom Blade on a creature → creature moves to graveyard. Commit.

---

### Task 56: `GainLifeEffect` + `LoseLifeEffect`

**Files:** `effects/gain-life.ts` + `effects/lose-life.ts` + tests.

```ts
export class GainLifeEffect extends SpellAbilityEffect {
  static readonly handlerKey = "GainLife";
  override *resolve(sa, game) {
    const n = evaluateParamNumber(sa, "LifeAmount", game);
    for (const seat of targetPlayers(sa)) {
      yield* game.action.changeLife(seat, +n, "effect");
    }
  }
}
```

LoseLife: opposite sign.

Test: Healing Salve → 3 life gain. Soul's Attendant-lite → trigger path (beyond M7 — defer triggers to Part D).

Commit.

---

### Task 57: Effect suite self-register bootstrap

**Files:** modify `packages/game/src/ability/effects/index.ts` (create if missing)

```ts
// Import-for-side-effects — populates the effect registry at package load.
import "./deal-damage.js";
import "./draw.js";
import "./destroy.js";
import "./gain-life.js";
import "./lose-life.js";
```

Re-export from `packages/game/src/ability/index.ts`.

Verify: `effectRegistry.has("DealDamage")` is true after importing `@mtg-forge-ts/game`.

Commit.

---

## Milestone M8 — Factory dispatch (3 tasks)

### Task 58: `Card.activateAbilitiesFromDefinition`

**Files:** modify `packages/game/src/card.ts` + new test.

**Logic:** walks `paperCard.definition.abilities` (the `AbilityAst[]`), constructs a `SpellAbility` for each AST, stores them on the card's `abilities` field (or similar runtime list). Called when a card enters a zone where abilities are active (battlefield; or stack for spells).

```ts
// In card.ts
export class Card {
  // ... existing fields ...
  public abilities: SpellAbility[] = [];

  activateAbilitiesFromDefinition(): void {
    const def = this.paperCard.definition;
    this.abilities = def.abilities.map((ast) =>
      new SpellAbility(ast as AbilityAst, this.id, this.controllerSeat, [])
    );
  }
}
```

Also carry the svars map: `SpellAbility` gets the card's svars from `def.svars`.

Test: create a Card from a parsed Lightning Bolt definition, call activateAbilitiesFromDefinition, verify `card.abilities[0].handlerKey === "DealDamage"`.

Commit.

---

### Task 59: Wire resolver into CastPipeline.finalizeStackItem

**Files:** modify `packages/game/src/cast/cast-pipeline.ts`.

**Change:** replace the `null` resolver in `finalizeStackItem` with one built from the SpellAbility that's casting. The pipeline has `ctx.sourceCardId` and needs to find the specific ability being cast — for spells, that's the first (and often only) A: ability on the source. For M8 MVP: take `card.abilities[0]`, bind any X value and targets from ctx, build `SpellAbility.makeResolver()`, attach.

```ts
protected finalizeStackItem(ctx: CastContext): StackItem {
  // ... existing provenance build ...
  const sourceCard = this.game.cards.get(ctx.sourceCardId);
  const sa = sourceCard?.abilities[0]; // spell's A: ability
  const resolver = sa ? sa.makeResolver() : null;
  return {
    id,
    kind: "spell",
    sourceCardId: ctx.sourceCardId,
    controllerSeat: ctx.castingPlayer,
    resolver,
    provenance,
  };
}
```

For cards with targets, the SpellAbility.targets needs to be populated from `ctx.targetsByMode` (existing SP2 field). Adapt — bind targets to the SpellAbility instance used here.

Test: cast Lightning Bolt targeting a player, resolve the stack, verify DealDamageEffect.resolve ran.

Commit.

---

### Task 60: Wire CostPayment orchestrator into CastPipeline.stepPayCosts

**Files:** modify `packages/game/src/cast/cast-pipeline.ts`.

**Change:** replace SP2's receipt-only stub with a real payment:
1. Build a `CostPlan` from `ctx.totalCost` (mana cost) + any alt-cost additional costs.
2. Call `yield* payCost(plan, costCtx)` — this runs CostMana/CostTap/etc.
3. Store receipts on `ctx.paidAlready` (so abort path can undo via `undoCost`).

Preserve existing abort semantics — if any yielded decision fails or the pipeline aborts, iterate `ctx.paidAlready` LIFO and call `undoCost`.

Test: cast Lightning Bolt with 1 R in pool — pool drained by 1 R, CostPaid event fires. Cast with empty pool — pipeline aborts, pool unchanged.

Commit.

---

## Milestone M9 — Flagship integration (2 tasks)

### Task 61: Lightning Bolt end-to-end

**Files:** `packages/game/test/flagship/lightning-bolt.test.ts`

**Scenario:** 2-player Game. Controller has Lightning Bolt in hand + 1 R in pool. Cast Lightning Bolt targeting opponent. Resolve. Assert: opponent life = 17 (from 20-3), Lightning Bolt in graveyard, pool empty.

```ts
// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, it, expect } from "vitest";
import { parseCard } from "@mtg-forge-ts/cards";
import { Game, /* test helpers */ } from "@mtg-forge-ts/game";
// Self-register effects + cost parts
import "@mtg-forge-ts/game"; // triggers all registrations

describe("Flagship: Lightning Bolt end-to-end", () => {
  it("deals 3 damage to a player when cast + resolved", () => {
    const boltDef = parseCard(boltSrc, "lightning_bolt.txt");
    const game = buildTestGame({ /* p0 with bolt in hand, R in pool */ });
    const opponent = 1 as PlayerSeat;
    // Drive CastPipeline + resolve.
    // Assertions.
  });
});
```

Build whatever test helpers are needed (mini Game factory, PaperCard-from-definition). Prior integration tests in game/src/test/integration/ are the pattern.

Commit.

---

### Task 62: Healing Salve end-to-end + M9 gate

**Files:** `packages/game/test/flagship/healing-salve.test.ts`

**Scenario:** Salve gains 3 life; after resolve, controller life = 23.

Commit.

**M9 gate: full system test**

```bash
pnpm typecheck && pnpm test && pnpm build && pnpm lint && pnpm lint:determinism
```

All green. New test count: 2017 + ~40 from M4-M9.

---

## Deferred (Part D+)

- Remaining 26 cost classes (CostExile, CostDiscard, CostMill, CostReveal, CostReturn, etc.)
- Cost reductions (static abilities like Squee's Embrace reducing cost)
- Cost increases (Ward, Kicker-as-surcharge)
- Valid grammar (`Creature.YouCtrl+attacking` style) — needed for many targeting + SumPower
- LayerEngine-aware effective P/T → unblocks SumPower/Toughness
- Remaining effect handlers (200+)
- Trigger handlers (139) — Part E
- Replacement handlers (46) — Part F
- Keyword handlers (34) — Part G
- AltCostRegistry (Flashback/Madness/Foretell/Bestow/Overload alt-cast paths)
- Semantic validator (Part H)

## Still-deferred SP2 Round 1 audit findings

A-004 (CastPipeline face leak), I-3 (commander as replacement), I-5 (Layer 7e null P/T), I-6 (orderer empty branch), I-8 (delayed-trigger suppression), I-11 (registry source-id tagging), I-12 (SBA terminalState), I-14 (Card.timestamp — **fix in Task 58** if convenient), I-16 (CDA-first cross-layer), I-17 (emblem controller), Stack.copy re-parent.
