# SP2 — Rules Systems Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Turn SP1's scaffolded engine into a fully functional Magic rules engine (layers, SBAs, triggers, replacements, statics, combat, cast pipeline, priority orchestrator, attachment, phasing, face-down, copy, multi-face, The Ring, turn/phase-sequence manipulation, loop detection, stack-copy, resolve-time decisions, game-end flow).

**Architecture:** Every rules subsystem sits behind a registry. Card zone-changes register/unregister into the relevant registries. `GameAction` remains the single mutation channel for card/player/zone/counter/life/stack state. `CombatHandler` remains the single mutator of `CombatState`. Subsystem-internal mutators (e.g., LayerEngine's epoch cache) stay private. Generator contract preserved end-to-end.

**Tech Stack:** TypeScript strict, vitest + fast-check, tsup ESM+CJS, biome, pnpm workspace. SP1 non-negotiables apply.

**Forge reference root:** `F:\BACKUP\Programacion\forge\`. Key paths:
- `forge-game/src/main/java/forge/game/staticability/` — statics + layers
- `forge-game/src/main/java/forge/game/replacement/` — replacements
- `forge-game/src/main/java/forge/game/trigger/` — triggers
- `forge-game/src/main/java/forge/game/combat/` — combat
- `forge-game/src/main/java/forge/game/spellability/` — cast pipeline
- `forge-game/src/main/java/forge/game/GameAction.java` — mutation channel + SBAs

**Branch:** `sp1-engine-foundations` (SP2 commits land on top).

---

## Conventions (apply to every task)

- Every new `.ts` file starts with `// SPDX-License-Identifier: GPL-3.0-or-later`.
- Every new discriminated-union type has a `kind` discriminator + deep `readonly`.
- Every new `switch (x.kind)` ends with `default: { const _: never = x; throw new Error(\`unreachable \${JSON.stringify(_)}\`); }`.
- Every new event kind has `readonly version: 1`; bump on breaking payload change.
- All mutation through `GameAction` / `CombatHandler` / documented subsystem-internal.
- No `Math.random` / `Date.now` / `crypto.randomUUID` / `performance.now` / `new Date` in `packages/game` or `packages/ai`.
- Commit with `git commit -s -m "type(scope): subject"`; no `Co-Authored-By`.
- Gate at milestone boundaries: `pnpm -r typecheck && pnpm -r test && pnpm -r build && pnpm biome check .`
- **When Forge disagrees with this plan, Forge wins. Document the deviation in the commit.**
- For each task: 5 steps — (1) write failing test, (2) run to verify fail, (3) implement, (4) run to verify pass, (5) commit. Steps 2 and 4 run the narrowest vitest filter; full gate runs at milestone boundary.

---

## Milestones overview

| ID | Title | Tasks | Scope |
|---|---|---|---|
| A | Characteristics + Layer engine | 1–9 | CR 613 layers, epoch cache, dependency resolver |
| B | Abilities + LKI + event taxonomy lock | 10–12 | Ability interfaces, LKI snapshot, event versions |
| C | Target system | 13–15 | CR 601/608 targeting at cast + resolve |
| D | Replacement registry | 16–19 | CR 614/616 + ETB self-replacement |
| E | Trigger registry | 20–24 | APNAP + LKI + delayed + linked + suppression |
| F | Static effect registry | 25–28 | Zone-activation + layer contributors + cost-mod + can't/must/may |
| G | State-based actions | 29–32 | All CR 704.5 SBAs + fixpoint |
| H | Continuous effects + duration | 33–34 | EffectDuration evaluator + phase expiry |
| I | Cast pipeline | 35–39 | CR 601.2 10-step + abort/rollback |
| J | Priority orchestrator | 40–41 | runPriorityWindow loop |
| K | Attachment subsystem | 42–43 | Auras/equipment/fortifications + Layer 6 grants |
| L | Ownership vs control + zone routing | 44–45 | Owner-routing + CR 800.4 |
| M | Combat | 46–51 | Damage assignment + keywords + battles + team |
| N | Phasing | 52 | CR 702.26 |
| O | Face-down | 53–54 | Morph/Manifest/Foretell/Disguise/Cloak |
| P | Copy effects | 55–57 | CR 707 + stack-copy |
| Q | Multi-face | 58–61 | Split/aftermath/flip/DFC/modal-DFC/adventure/meld/mutate/host-augment |
| R | The Ring | 62–63 | Ring state + temptation + level grants |
| S | Turn/phase sequence | 64–65 | Extra turns + skip steps |
| T | Loop detection hook | 66 | requestShortcut primitive |
| U | Resolve-time decisions | 67 | Generator-based Effect.resolve |
| V | Game-end flow + terminal enrichment | 68 | CR 800.4 cleanup + reason taxonomy |
| W | SP1-audit deferred cleanup | 69–74 | scry/surveil/proliferate/tokens/opening-hand/companion/RandomLegal/GameFlags |
| X | Snapshot v6 + integration + property + audit | 75–78 | Schema bump + end-to-end tests + 4-reviewer audit |

Total: 78 tasks across 24 milestones.

---

## File plan (top-level dirs created)

**Core package (`packages/core/src/`):**
- `effects/layer.ts`, `characteristics/characteristics.ts`, `abilities/*.ts`, `lki/lki.ts`

**Game package (`packages/game/src/`):**
- `layers/*.ts` (A), `sba/*.ts` (G), `triggers/*.ts` (E), `replacements/*.ts` (D), `statics/*.ts` (F), `continuous/*.ts` (H), `cast/*.ts` (I), `priority/*.ts` (J), `attachment/*.ts` (K), `phasing/*.ts` (N), `face-down/*.ts` (O), `copy/*.ts` (P), `multiface/*.ts` (Q), `ring/*.ts` (R), `loop/*.ts` (T), `resolve/*.ts` (U), `game-end/*.ts` (V).

Each new directory has an `index.ts` barrel; `packages/game/src/index.ts` re-exports it.

---

# Milestone A — Characteristics type & Layer engine

Goal: compute a Card's runtime `Characteristics` by walking CR 613's 7 layers from base state, with within-layer dependency→timestamp ordering, and an epoch cache that invalidates on board changes.

**Forge refs:** `Card.java`, `CardState.java`, `StaticAbilityLayer.java`, `StaticAbilityContinuous.java`, `GameAction.java#checkStaticAbilities()`.

---

### Task 1: `Layer` enum + `Characteristics` interface

**Files:**
- Create `packages/core/src/effects/layer.ts`, `packages/core/src/characteristics/characteristics.ts`, `.../index.ts`
- Modify `packages/core/src/index.ts` (new barrel exports)
- Test: `packages/core/src/effects/layer.test.ts`, `packages/core/src/characteristics/characteristics.test.ts`

**Failing tests:**
```ts
// layer.test.ts
import { describe, expect, it } from "vitest";
import { Layer, LAYER_ORDER } from "./layer.js";
describe("Layer enum", () => {
  it("has 11 entries (1,2,3,4,5,6,7a,7b,7c,7d,7e)", () => {
    expect(Object.values(Layer).filter((v) => typeof v === "number")).toHaveLength(11);
  });
  it("LAYER_ORDER runs 1..7e canonically", () => {
    expect(LAYER_ORDER).toEqual([
      Layer.L1_Copy, Layer.L2_Control, Layer.L3_Text, Layer.L4_Type, Layer.L5_Color,
      Layer.L6_Ability, Layer.L7a_PTCda, Layer.L7b_PTSet, Layer.L7c_PTModify,
      Layer.L7d_PTCounter, Layer.L7e_PTSwitch,
    ]);
  });
});

// characteristics.test.ts
import { describe, expect, it } from "vitest";
import { ColorSet, Color, emptyCharacteristics, CardType, Supertype } from "@mtg-forge-ts/core";
describe("emptyCharacteristics", () => {
  it("baseline: empty sets, null P/T/loyalty/defense, no abilities", () => {
    const c = emptyCharacteristics();
    expect(c.name).toBe(""); expect(c.rulesText).toBe("");
    expect(c.colorIndicator).toBeNull();
    expect([...c.supertypes]).toEqual([]); expect([...c.types]).toEqual([]); expect([...c.subtypes]).toEqual([]);
    expect(c.colors.equals(ColorSet.empty())).toBe(true);
    expect(c.power).toBeNull(); expect(c.toughness).toBeNull();
    expect(c.loyalty).toBeNull(); expect(c.defense).toBeNull();
    expect(c.abilities).toEqual([]);
  });
  it("returned sets are per-call independent (no aliasing)", () => {
    const a = emptyCharacteristics(), b = emptyCharacteristics();
    a.supertypes.add(Supertype.Legendary); a.types.add(CardType.Creature);
    expect(b.supertypes.size).toBe(0); expect(b.types.size).toBe(0);
  });
});
```

**Impl:**
```ts
// effects/layer.ts
export enum Layer {
  L1_Copy = 1, L2_Control = 2, L3_Text = 3, L4_Type = 4, L5_Color = 5,
  L6_Ability = 6, L7a_PTCda = 71, L7b_PTSet = 72, L7c_PTModify = 73,
  L7d_PTCounter = 74, L7e_PTSwitch = 75,
}
export const LAYER_ORDER: readonly Layer[] = [
  Layer.L1_Copy, Layer.L2_Control, Layer.L3_Text, Layer.L4_Type, Layer.L5_Color,
  Layer.L6_Ability, Layer.L7a_PTCda, Layer.L7b_PTSet, Layer.L7c_PTModify,
  Layer.L7d_PTCounter, Layer.L7e_PTSwitch,
];
export interface LayerEffect {
  readonly layer: Layer;
  readonly timestamp: number;
  readonly sourceAbilityId: import("../ids.js").EntityId | null;
}
```

```ts
// characteristics/characteristics.ts
import type { Supertype, CardType, Subtype } from "../card/index.js";
import { ColorSet } from "../color.js";
import { ManaCost } from "../mana/index.js";
import type { EntityId } from "../ids.js";

export interface ActiveAbilityRef {
  readonly id: EntityId;
  readonly grantedBy: EntityId | null;
  readonly origin: "intrinsic" | "layer6" | "aura" | "copy";
}

export interface Characteristics {
  name: string;
  manaCost: ManaCost;
  colorIndicator: ColorSet | null;
  supertypes: Set<Supertype>;
  types: Set<CardType>;
  subtypes: Set<Subtype>;
  colors: ColorSet;
  rulesText: string;
  power: number | null;
  toughness: number | null;
  loyalty: number | null;
  defense: number | null;
  abilities: ActiveAbilityRef[];
}

export const emptyCharacteristics = (): Characteristics => ({
  name: "", manaCost: ManaCost.empty(), colorIndicator: null,
  supertypes: new Set(), types: new Set(), subtypes: new Set(),
  colors: ColorSet.empty(), rulesText: "",
  power: null, toughness: null, loyalty: null, defense: null,
  abilities: [],
});
```

Barrels: add `export * from "./layer.js";` to `effects/index.ts`; add `characteristics/index.ts` with `export * from "./characteristics.js";`; add both to `packages/core/src/index.ts`.

**Commit:** `feat(core): add Layer enum and Characteristics type for SP2 layer engine`

---

### Task 2: `LayerEngine` skeleton + epoch cache

**Files:**
- Create `packages/game/src/layers/layer-engine.ts`, `base-characteristics.ts`, `index.ts`
- Modify `packages/game/src/index.ts` (barrel) and `game.ts` (add `readonly layerEngine: LayerEngine`; construct in ctor)
- Test: `packages/game/src/layers/layer-engine.test.ts`

**Failing test:** construct Game; assert `g.layerEngine.currentEpoch === 0`; `bumpEpoch("x")` increments; `computeCharacteristics(unknown)` throws `GameStateIntegrityError` matching `/not found/`; `getCached(id)` returns undefined before compute, defined after.

**Impl:**
```ts
// base-characteristics.ts
import { emptyCharacteristics, type Characteristics } from "@mtg-forge-ts/core";
import type { Card } from "../card.js";
export const deriveBaseCharacteristics = (card: Card): Characteristics => {
  const base = emptyCharacteristics();
  if (card.paperCard.name !== undefined) base.name = card.paperCard.name;
  // SP4 fills additional fields from PaperCard.definition once CardDb lands.
  return base;
};
```

```ts
// layer-engine.ts
import { LAYER_ORDER, type Characteristics, type EntityId, GameStateIntegrityError } from "@mtg-forge-ts/core";
import type { Game } from "../game.js";
import { deriveBaseCharacteristics } from "./base-characteristics.js";

export interface LayerCacheEntry { readonly chars: Characteristics; readonly epoch: number; }

export class LayerEngine {
  private epoch = 0;
  private readonly cache = new Map<EntityId, LayerCacheEntry>();
  constructor(private readonly game: Game) {}
  get currentEpoch(): number { return this.epoch; }
  bumpEpoch(_reason: string): void { this.epoch++; this.cache.clear(); }
  getCached(id: EntityId): LayerCacheEntry | undefined { return this.cache.get(id); }
  computeCharacteristics(id: EntityId): Characteristics {
    const cached = this.cache.get(id);
    if (cached && cached.epoch === this.epoch) return cached.chars;
    const card = this.game.cards.get(id);
    if (!card) throw new GameStateIntegrityError(`LayerEngine: card ${id} not found`);
    const chars = deriveBaseCharacteristics(card);
    for (const _layer of LAYER_ORDER) { /* Tasks 3-9 populate */ }
    this.cache.set(id, { chars, epoch: this.epoch });
    return chars;
  }
}
```

Modify `game.ts`: add `readonly layerEngine: LayerEngine;` and `this.layerEngine = new LayerEngine(this);` in ctor (before `this.flags = createDefaultFlags();`).

**Commit:** `feat(game): add LayerEngine skeleton with epoch cache (SP2 §1)`

---

### Task 3: Layer 1 — Copy effects

**Files:** Create `packages/game/src/layers/layer1-copy.ts`, `packages/game/src/copy/copiable-characteristics.ts`, `copy/index.ts`. Modify `layer-engine.ts` (invoke Layer 1), `card.ts` (type `copiedFrom: CopiableCharacteristics | null`), `index.ts` (barrel).

**Failing test:** apply `applyLayer1Copy(c, null)` → no-op. Apply with a `CopiableCharacteristics` source → `c.name`, `types`, `power`, `toughness`, `rulesText`, `colors` all overwritten per CR 707.2. Assert `c.abilities` unchanged (layer 1 doesn't clone abilities — SP3/Task 55 expands).

**Impl:**
```ts
// copy/copiable-characteristics.ts
import type { Supertype, CardType, Subtype, ColorSet, ManaCost } from "@mtg-forge-ts/core";
export interface CopiableCharacteristics {
  readonly name: string;
  readonly manaCost: ManaCost;
  readonly colorIndicator: ColorSet | null;
  readonly supertypes: ReadonlySet<Supertype>;
  readonly types: ReadonlySet<CardType>;
  readonly subtypes: ReadonlySet<Subtype>;
  readonly colors: ColorSet;
  readonly rulesText: string;
  readonly power: number | null;
  readonly toughness: number | null;
  readonly loyalty: number | null;
  readonly defense: number | null;
}

// layers/layer1-copy.ts
import type { Characteristics } from "@mtg-forge-ts/core";
import type { CopiableCharacteristics } from "../copy/copiable-characteristics.js";
export const applyLayer1Copy = (target: Characteristics, source: CopiableCharacteristics | null): void => {
  if (source === null) return;
  target.name = source.name; target.manaCost = source.manaCost;
  target.colorIndicator = source.colorIndicator;
  target.supertypes = new Set(source.supertypes);
  target.types = new Set(source.types);
  target.subtypes = new Set(source.subtypes);
  target.colors = source.colors;
  target.rulesText = source.rulesText;
  target.power = source.power; target.toughness = source.toughness;
  target.loyalty = source.loyalty; target.defense = source.defense;
};
```

Modify `layer-engine.ts#computeCharacteristics`: after `deriveBaseCharacteristics`, call `applyLayer1Copy(chars, card.copiedFrom);`. Tighten `Card.copiedFrom` type.

**Commit:** `feat(game): implement Layer 1 (copy effects) per CR 613.1a`

---

### Task 4: Layer 2 — Control (no-op on Characteristics, epoch-bump hook)

**Files:** Create `layer2-control.ts` (exports a no-op `applyLayer2Control`). Modify `game-action.ts#changeControl` to call `this.game.layerEngine.bumpEpoch("control-change")` after mutation.

**Failing test:** `applyLayer2Control()` returns undefined (pure no-op). Integration: `changeControl(cid, newSeat)` bumps epoch.

**Rationale:** controller lives on `Card`, not `Characteristics`. Layer 2's semantics are "controller as of now"; queries go straight to `Card.controllerSeat`. Epoch bump invalidates any cached layer walks that read controller through ability context.

**Commit:** `feat(game): wire Layer 2 (control) epoch-bump hook`

---

### Task 5: Layer 3 — Text-changing

**Files:** Create `layers/layer3-text.ts` + test.

**Failing test:** single-word substitution; multi-substitution in timestamp order; empty list = unchanged; word-boundary matching (does NOT match inside "mini-creatures").

**Impl:**
```ts
export interface TextSubstitution { readonly from: string; readonly to: string; readonly timestamp: number; }
export const applyLayer3Text = (target: Characteristics, subs: readonly TextSubstitution[]): void => {
  if (subs.length === 0) return;
  const ordered = [...subs].sort((a, b) => a.timestamp - b.timestamp);
  for (const sub of ordered) {
    const escaped = sub.from.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    target.rulesText = target.rulesText.replace(new RegExp(`\\b${escaped}\\b`, "g"), sub.to);
  }
};
```

`layer-engine.ts`: `readonly textSubstitutions: TextSubstitution[] = [];` + `applyLayer3Text(chars, this.textSubstitutions);` after Layer 2.

**Commit:** `feat(game): implement Layer 3 (text-changing) per CR 613.1c`

---

### Task 6: Layer 4 — Type-changing + CDAs

**Files:** `layers/layer4-type.ts` + test.

**Failing test:** `add`/`remove`/`becomes` kinds; CDA applies before non-CDA (CR 604.3); within each partition, timestamp order.

**Impl (signature):**
```ts
export type TypeChangeEffect =
  | { readonly kind: "add"; readonly cardType: CardType; readonly isCda: boolean; readonly timestamp: number; readonly sourceAbilityId: EntityId | null }
  | { readonly kind: "remove"; readonly cardType: CardType; readonly isCda: boolean; readonly timestamp: number; readonly sourceAbilityId: EntityId | null }
  | { readonly kind: "becomes"; readonly types: ReadonlySet<CardType>; readonly isCda: boolean; readonly timestamp: number; readonly sourceAbilityId: EntityId | null };
export const applyLayer4Type = (target: Characteristics, effects: readonly TypeChangeEffect[]): void => {
  const cdas = effects.filter((e) => e.isCda).sort((a, b) => a.timestamp - b.timestamp);
  const normals = effects.filter((e) => !e.isCda).sort((a, b) => a.timestamp - b.timestamp);
  for (const e of [...cdas, ...normals]) {
    switch (e.kind) {
      case "add": target.types.add(e.cardType); break;
      case "remove": target.types.delete(e.cardType); break;
      case "becomes": target.types.clear(); for (const t of e.types) target.types.add(t); break;
      default: { const _: never = e; throw new Error(`unreachable ${JSON.stringify(_)}`); }
    }
  }
};
```

**Commit:** `feat(game): implement Layer 4 (type-changing + CDAs) per CR 613.1d`

---

### Task 7: Layer 5 — Color-changing + CDAs

**Files:** `layers/layer5-color.ts` + test. Identical CDA-ordering logic to Task 6.

**Kinds:** `set` / `add` / `remove`. `remove` uses bit-math on ColorSet via `toJSON` → `ColorSet.fromJSON(a & ~b)`.

**Commit:** `feat(game): implement Layer 5 (color-changing + CDAs) per CR 613.1e`

---

### Task 8: Layer 6 — Ability add/remove

**Files:** `layers/layer6-ability.ts` + test.

**Kinds:** `add` (push ActiveAbilityRef), `removeAll` (filter by grantedBy), `loseAll` (clear entire array). Timestamp-ordered.

**Failing test:** add, removeAll by grantedBy, loseAll (strips intrinsic too), ordering (loseAll at t=1 then add at t=2 → only the added ability remains).

**Commit:** `feat(game): implement Layer 6 (ability add/remove) per CR 613.1f`

---

### Task 9: Layer 7a–7e + dependency resolver + epoch-bump integration

**Files:** `layers/layer7-pt.ts`, `layers/dependency-resolver.ts` + tests. Modify `game-action.ts` to bumpEpoch in `moveTo`, `tap`, `untap`, `addCounter`, `removeCounter` (changeControl already wired Task 4).

**Failing tests (layer7):** 7a cdaSet, 7b set overrides 7a, 7c modify adds to 7b, 7d +1/+1 and -1/-1, 7d can drive to 0/0, 7e switch 3/5→5/3, 7e twice = no-op.

**Failing tests (dep-resolver):** no-deps = pure timestamp sort; A→B yields B before A regardless of timestamp; cycle falls back to timestamp; diamond topologically sorted.

**Failing tests (epoch):** addCounter / moveTo / changeControl each bump epoch.

**Impl (dependency-resolver, simplified Kahn):**
```ts
export interface DepNode<T> { readonly id: string; readonly timestamp: number; readonly dependsOn: readonly string[]; readonly raw?: T; }
export const resolveDependencyOrder = <T extends DepNode<unknown>>(effects: readonly T[]): T[] => {
  const byId = new Map(effects.map((e) => [e.id, e] as const));
  if (detectCycle(effects)) return [...effects].sort((a, b) => a.timestamp - b.timestamp);
  const indeg = new Map(effects.map((e) => [e.id, e.dependsOn.filter((d) => byId.has(d)).length]));
  const ready = effects.filter((e) => indeg.get(e.id) === 0).sort((a, b) => a.timestamp - b.timestamp);
  const out: T[] = [];
  while (ready.length) {
    const n = ready.shift()!;
    out.push(n);
    for (const e of effects) if (e.dependsOn.includes(n.id)) {
      const v = (indeg.get(e.id) ?? 0) - 1;
      indeg.set(e.id, v);
      if (v === 0 && !out.includes(e) && !ready.includes(e)) { ready.push(e); ready.sort((a, b) => a.timestamp - b.timestamp); }
    }
  }
  return out;
};
const detectCycle = (effects: readonly DepNode<unknown>[]): boolean => { /* DFS white/gray/black — full impl per Forge-style topo */ };
```

**Impl (layer7):** see Forge `StaticAbilityContinuous#setPT` / `#addPT` / counter processing in `Card#getNetPower` / `getNetToughness`.

**Layer-engine wiring:** add `pt7a/pt7b/pt7c/pt7d/pt7e` arrays + typeEffects/colorEffects/abilityEffects/textSubstitutions; apply in order in `computeCharacteristics`.

**Commit:** `feat(game): implement Layers 7a-7e + dependency resolver + epoch integration (SP2 §1)`

**Milestone A gate:** `pnpm -r typecheck && pnpm -r test && pnpm -r build && pnpm biome check .` all green.

---

# Milestone B — Abilities + LKI + event taxonomy lock

Goal: pin down ability interfaces used by registries (D/E/F/I); add `LastKnownInfo` type for leaves-battlefield / dies triggers; audit every existing `GameEvent` for `version: 1` + document forward-compat.

---

### Task 10: Ability interfaces in core

**Files:** Create `packages/core/src/abilities/{active-ability.ts,triggered-ability.ts,replacement-ability.ts,static-ability.ts,activated-ability.ts,delayed-trigger.ts,index.ts}`.

**Failing test:** type-only smoke (import each interface; assert a hand-built subtype satisfies it). These are pure shape types; SP3 plugs real bodies.

**Key interfaces:**
```ts
// abilities/active-ability.ts
import type { EntityId, ZoneType } from "../ids.js";
import type { Characteristics } from "../characteristics/characteristics.js";

export type AbilityKind = "static" | "triggered" | "replacement" | "activated" | "mana";

export interface AbilityBase {
  readonly id: EntityId;
  readonly kind: AbilityKind;
  readonly sourceCardId: EntityId;
  readonly activeInZones: ReadonlySet<ZoneType>;
  readonly timestamp: number;
  readonly controllerSeatAtReg: import("../ids.js").PlayerSeat | null;
}

// triggered-ability.ts
import type { GameEvent } from "../events/event.js";
import type { AbilityBase } from "./active-ability.js";
export interface TriggeredAbility extends AbilityBase {
  readonly kind: "triggered";
  matches(event: GameEvent): boolean;            // primary gate
  interveningIf?(event: GameEvent, game: unknown): boolean;  // CR 603.4
  captureLki?(event: GameEvent, game: unknown): unknown;     // trigger-time snapshot
  readonly linkedTo?: EntityId;                               // CR 607
  readonly isDelayed: boolean;
}

// replacement-ability.ts
export type MutationIntent = Readonly<Record<string, unknown>> & { readonly kind: string };
export interface ReplacementAbility extends AbilityBase {
  readonly kind: "replacement";
  matches(intent: MutationIntent): boolean;
  apply(intent: MutationIntent, game: unknown): MutationIntent | null;  // null = prevent
  readonly isSelfReplacement: boolean;
}

// static-ability.ts
export interface StaticAbility extends AbilityBase {
  readonly kind: "static";
  readonly category:
    | "continuous" | "costModification" | "cantMustMay"
    | "replacementGenerating" | "preventDamage" | "ruleChanging"
    | "abilityGranting" | "alternativeCost";
  describe(): unknown;
}

// activated-ability.ts
export interface ActivatedAbility extends AbilityBase {
  readonly kind: "activated" | "mana";
  readonly costDsl: string;
  readonly effectDsl: string;
  readonly isManaAbility: boolean;
}

// delayed-trigger.ts
export interface DelayedTrigger extends AbilityBase {
  readonly kind: "triggered";
  readonly isDelayed: true;
  readonly createdAtTurn: number;
  readonly creationContext: Readonly<Record<string, unknown>>;
  readonly oneShot: boolean;
  matches(event: GameEvent): boolean;
}
```

**Commit:** `feat(core): add ability interfaces (static/triggered/replacement/activated/delayed) for SP2 registries`

---

### Task 11: LKI (Last Known Information) type

**Files:** Create `packages/core/src/lki/lki.ts`, `lki/index.ts`; add barrel.

**Failing test:** construct an LKI snapshot with `captureLki(card, game)`; assert fields captured (id, name, types, controller, zone, power/toughness). Re-mutate the card's characteristics; assert LKI is unchanged.

**Impl:**
```ts
import type { EntityId, PlayerSeat, ZoneType } from "../ids.js";
import type { Characteristics } from "../characteristics/characteristics.js";

export interface LastKnownInfo {
  readonly cardId: EntityId;
  readonly timestamp: number;
  readonly chars: Readonly<Characteristics>;
  readonly zone: ZoneType;
  readonly controllerSeat: PlayerSeat | null;
  readonly tapped: boolean;
  readonly damage: number;
}

export const captureLki = (args: { cardId: EntityId; timestamp: number; chars: Characteristics; zone: ZoneType; controllerSeat: PlayerSeat | null; tapped: boolean; damage: number }): LastKnownInfo => ({
  cardId: args.cardId, timestamp: args.timestamp,
  chars: Object.freeze({
    ...args.chars,
    supertypes: new Set(args.chars.supertypes),
    types: new Set(args.chars.types),
    subtypes: new Set(args.chars.subtypes),
    abilities: [...args.chars.abilities],
  }),
  zone: args.zone, controllerSeat: args.controllerSeat,
  tapped: args.tapped, damage: args.damage,
});
```

**Commit:** `feat(core): add LastKnownInfo snapshot type for SP2 triggers/replacements`

---

### Task 12: Event taxonomy lock + version audit

**Files:** Modify `packages/core/src/events/event.ts` (ensure every event kind has `readonly version: 1`). Add or confirm missing kinds: `EventPrevented`, `ShortcutApplied`, `CastAborted`, `StackItemResolved`, `TriggerQueued`, `TriggerResolved`, `ReplacementApplied`, `StateBasedActionApplied`, `StaticAbilityRegistered`/`Unregistered`, `ContinuousEffectRegistered`/`Expired`, `LayerEpochBumped` (optional; may gate behind a debug flag), `PhaseStarted`/`Ended` refinements. **No schema version bump if all events stay at `version: 1`.** Update `.test.ts` to enumerate every GameEvent kind and assert the invariant `version === 1` for every payload.

**Failing test:** `for (const evt of allGameEventKinds()) expect(mkEvent(evt, 1, Phase.Main1, {}).version).toBe(1);` — introspect the kind union; use `satisfies Record<GameEvent["kind"], true>` exhaustiveness to force compile error if a kind is missing.

**Commit:** `feat(core): lock event taxonomy at version:1 and add SP2-required event kinds`

**Milestone B gate:** full gate green.

---

# Milestone C — Target system

Goal: replace SP1 scaffold with full CR 601/608 target legality at cast and at resolve; support divide-X distribution; redirect hook for replacements.

**Forge refs:** `forge-game/src/main/java/forge/game/ability/AbilityUtils.java`, `TargetChoices.java`, `SpellAbility#getTargets()`.

---

### Task 13: `validateAtCast` — enumeration + restriction checks

**Files:** Rewrite `packages/game/src/target/target-system.ts`; add `target/restrictions.ts`, `target/enumeration.ts`; extend test.

**Failing test:** build a synthetic spell ability with a `TargetRestriction` (e.g., "target creature you control"); verify `validateAtCast` approves a legal selection and rejects an illegal one. Divide-X: assert division total equals announced X. Zero-target: `requires(min=0)` passes empty choice.

**Impl signature:**
```ts
export interface TargetRestriction {
  readonly controllerScope: "you" | "opponent" | "any";
  readonly permitZones: ReadonlySet<ZoneType>;
  readonly permitTypes: ReadonlySet<CardType>;
  readonly forbidTypes: ReadonlySet<CardType>;
  readonly protectionKeywords?: readonly string[];
  readonly shroud?: boolean;
  readonly hexproof?: boolean;
  readonly minTargets: number;
  readonly maxTargets: number;
  readonly divideX?: { readonly amount: number };
}

export class TargetSystem {
  constructor(private readonly game: Game) {}
  enumerate(sourceId: EntityId, restriction: TargetRestriction): readonly EntityId[] { /* walk cards in permitted zones, filter by restriction + controller + protection */ }
  validateAtCast(choices: TargetChoices, sourceId: EntityId, restriction: TargetRestriction): boolean { /* check count + each target legal + divisions sum */ }
  validateAtResolve(choices: TargetChoices, sourceId: EntityId, restriction: TargetRestriction): { legal: readonly EntityId[]; illegal: readonly EntityId[] } { /* re-check each at resolve time; partition */ }
  redirect(choices: TargetChoices, originalId: EntityId, replacementId: EntityId): TargetChoices { /* substitute originalId → replacementId, preserve divisions */ }
}
```

Wire `Game.targetSystem = new TargetSystem(this)` in ctor.

**Commit:** `feat(game): implement TargetSystem.validateAtCast with restrictions (SP2 §2a)`

---

### Task 14: `validateAtResolve` partition + fizzle logic

**Failing test:** spell with 2 targets; one becomes invalid between cast and resolve (creature gains protection); `validateAtResolve` returns `{legal: [A], illegal: [B]}`. All illegal → spell fizzles (caller responsibility; test returns `.legal.length === 0`).

**Impl:** re-run enumeration's legality check at resolve with the **current** game state; partition.

**Commit:** `feat(game): implement TargetSystem.validateAtResolve partition (SP2 §2a)`

---

### Task 15: Target redirect hook

**Failing test:** `redirect(choices, idA, idB)` returns a new `TargetChoices` with idA replaced by idB; divisions (if idA had amount K) are re-keyed to idB with amount K.

**Commit:** `feat(game): add TargetSystem.redirect for replacement effects`

**Milestone C gate:** full gate green.

---

# Milestone D — Replacement registry

Goal: CR 614/616 replacement chain intercepts every mutation before `GameAction` applies.

**Forge refs:** `forge-game/src/main/java/forge/game/replacement/ReplacementEffect.java`, `ReplacementHandler.java#run()`.

---

### Task 16: `ReplacementRegistry` class

**Files:** Create `packages/game/src/replacements/{replacement-registry.ts,replacement-intent.ts,index.ts}`; add barrel to `game/src/index.ts`; wire `Game.replacementRegistry`.

**Failing test:** register a replacement; `gatherApplicable(intent)` returns it when `matches` true, empty when false. Unregister → no longer returned.

**Impl:**
```ts
import type { ReplacementAbility, EntityId } from "@mtg-forge-ts/core";
export interface MutationIntent { readonly kind: string; readonly [k: string]: unknown; }

export class ReplacementRegistry {
  private readonly byId = new Map<EntityId, ReplacementAbility>();
  register(r: ReplacementAbility): void { this.byId.set(r.id, r); }
  unregister(id: EntityId): void { this.byId.delete(id); }
  gatherApplicable(intent: MutationIntent, excluded: ReadonlySet<EntityId>): readonly ReplacementAbility[] {
    return [...this.byId.values()].filter((r) => !excluded.has(r.id) && r.matches(intent));
  }
  all(): readonly ReplacementAbility[] { return [...this.byId.values()]; }
}
```

**Commit:** `feat(game): add ReplacementRegistry scaffold (SP2 §2e)`

---

### Task 17: CR 616 ordering with `orderReplacements` decision

**Files:** Modify `replacement-registry.ts` + add `replacement-orderer.ts`.

**Failing test:** 2 replacements applicable, single affected player → that player chooses; affected object only → controller chooses; else active player chooses. Generator yields `orderReplacements` decision, response sets the order.

**Impl signature:**
```ts
export function* orderReplacements(
  applicable: readonly ReplacementAbility[],
  intent: MutationIntent,
  game: Game,
): Generator<EngineYield, readonly EntityId[], DecisionResponse> {
  if (applicable.length <= 1) return applicable.map((r) => r.id);
  const orderer = chooseOrderer(intent, game);
  const response = yield { kind: "decision", request: { kind: "orderReplacements", playerSeat: orderer, replacementIds: applicable.map((r) => r.id) } };
  // validate response.order is a permutation of applicable.ids
  return response.order;
}
```

`chooseOrderer`: inspect intent for `affectedPlayer` → affected object's controller → active player.

**Commit:** `feat(game): implement CR 616 replacement ordering via orderReplacements decision`

---

### Task 18: ETB self-replacement + one-apply rule

**Files:** Create `replacements/etb-self.ts`; extend registry.

**Failing test:** an ETB event with a self-replacement (comes-into-play-tapped) AND an external replacement ("creatures ETB with +1/+1 counter") → self applies first (CR 614.1c-d). Each replacement applies at most once per intent (CR 614.5).

**Impl:** in the apply loop, partition applicables into self vs external each round; apply self-first, then external, track applied ids in a Set to enforce one-apply. Between rounds, re-gather because new replacements may become applicable.

**Commit:** `feat(game): add ETB self-replacement precedence + one-apply rule (CR 614.1c-d, 614.5)`

---

### Task 19: `GameAction` integration — every mutation runs replacement chain

**Files:** Modify `packages/game/src/action/game-action.ts`. Factor mutations into an internal `applyWithReplacements(intent)` helper that:
1. `gatherApplicable` on replacement registry.
2. `orderReplacements` if >1.
3. Apply each replacement in order; short-circuit on `null` (prevention) → emit `EventPrevented`.
4. Apply the (possibly mutated) intent + emit the canonical event.

**Failing test:** a prevention replacement on `DamageDealt` → `damage()` emits `EventPrevented` (not `DamageDealt`). A redirect replacement → damage lands on substituted target.

**Impl contract:**
```ts
private *applyWithReplacements(intent: MutationIntent): Generator<EngineYield, { applied: boolean; final: MutationIntent | null }, DecisionResponse> {
  let current = intent;
  const applied = new Set<EntityId>();
  while (true) {
    const list = this.game.replacementRegistry.gatherApplicable(current, applied);
    if (list.length === 0) break;
    const order = yield* orderReplacements(list, current, this.game);
    for (const rid of order) {
      const r = list.find((x) => x.id === rid); if (!r) continue;
      const next = r.apply(current, this.game);
      applied.add(rid);
      if (next === null) {
        yield { kind: "event", event: mkEvent("EventPrevented", this.game.turn, this.game.phase, { original: current }) };
        return { applied: true, final: null };
      }
      current = next;
    }
  }
  return { applied: true, final: current };
}
```

Update each existing mutator (damage, changeLife, drawCards, moveTo, addCounter, etc.) to route through this helper.

**Commit:** `feat(game): route every GameAction mutation through replacement chain (SP2 §2e)`

**Milestone D gate:** full gate green.

---

# Milestone E — Trigger registry

Goal: CR 603 triggered abilities with APNAP ordering, intervening-if, LKI snapshot, delayed triggers, linked abilities, suppression.

**Forge refs:** `forge-game/src/main/java/forge/game/trigger/TriggerHandler.java`, `Trigger.java`, `DelayedTrigger.java`.

---

### Task 20: `TriggerRegistry` + `onEvent` collector

**Files:** Create `packages/game/src/triggers/{trigger-registry.ts,pending-trigger.ts,index.ts}`; wire `Game.triggerRegistry`.

**Failing test:** register a trigger with `matches(CardEnteredBattlefield) = true`; feed a CardEnteredBattlefield event via `onEvent`; `pending` queue contains one instance referencing that trigger + event LKI.

**Impl:**
```ts
import type { GameEvent, LastKnownInfo, TriggeredAbility, EntityId } from "@mtg-forge-ts/core";

export interface PendingTrigger {
  readonly id: EntityId;
  readonly triggerId: EntityId;
  readonly event: GameEvent;
  readonly lki: LastKnownInfo | null;
  readonly sourceControllerAtFire: import("@mtg-forge-ts/core").PlayerSeat;
}

export class TriggerRegistry {
  private readonly byId = new Map<EntityId, TriggeredAbility>();
  private readonly pending: PendingTrigger[] = [];
  constructor(private readonly game: Game) {}
  register(t: TriggeredAbility): void { this.byId.set(t.id, t); }
  unregister(id: EntityId): void { this.byId.delete(id); }
  onEvent(event: GameEvent): void {
    for (const t of this.byId.values()) {
      if (!t.matches(event)) continue;
      if (t.interveningIf && !t.interveningIf(event, this.game)) continue;
      const lki = t.captureLki ? t.captureLki(event, this.game) as LastKnownInfo | null : null;
      const sourceCtl = this.resolveSourceController(t);
      this.pending.push({ id: this.game.newEntityId(), triggerId: t.id, event, lki, sourceControllerAtFire: sourceCtl });
    }
  }
  drain(): readonly PendingTrigger[] { const out = [...this.pending]; this.pending.length = 0; return out; }
  private resolveSourceController(t: TriggeredAbility): PlayerSeat { /* read Card.controllerSeat for t.sourceCardId or fall back to t.controllerSeatAtReg */ }
}
```

**Commit:** `feat(game): add TriggerRegistry with event collection (SP2 §2d)`

---

### Task 21: APNAP ordering

**Files:** Create `triggers/apnap-orderer.ts`.

**Failing test:** 3 pending triggers: 2 for active player, 1 for non-active. APNAP ordering yields active-player decision first (they order their 2), then non-active (orders their 1). Final order = [non-active-1, active-2, active-1] (stack bottom-up from decision-order).

**Impl:**
```ts
export function* apnapOrder(
  pending: readonly PendingTrigger[],
  activeSeat: PlayerSeat,
  seats: readonly PlayerSeat[],
): Generator<EngineYield, readonly PendingTrigger[], DecisionResponse> {
  const groups = groupByController(pending);
  const turnOrder = rotatedFromActive(seats, activeSeat);
  const finalTopDown: PendingTrigger[] = [];
  for (const seat of turnOrder) {
    const group = groups.get(seat) ?? [];
    if (group.length === 0) continue;
    if (group.length === 1) { finalTopDown.push(group[0]); continue; }
    const response = yield { kind: "decision", request: { kind: "orderTriggers", playerSeat: seat, triggerIds: group.map((g) => g.id) } };
    for (const id of response.order) {
      const t = group.find((g) => g.id === id); if (t) finalTopDown.push(t);
    }
  }
  // Stack is last-in first-out. Reverse so first in finalTopDown lands on top.
  return [...finalTopDown].reverse();
}
```

**Commit:** `feat(game): implement APNAP trigger ordering (CR 603.3b)`

---

### Task 22: Intervening-if + LKI snapshot integration

**Failing test:** trigger with intervening-if that's true at event time, false at resolve → trigger fires but effect doesn't apply. Trigger with `captureLki` that reads `Characteristics` → later mutation doesn't alter captured value.

**Impl:** already partly in Task 20's `onEvent` gating (intervening-if first check). Add **second check at resolve time** inside the generator that pops the pending trigger off the stack — see Task 67 (resolve contract). Ensure LKI is attached to the `StackItem.metadata` slot so `resolve` reads it.

**Commit:** `feat(game): wire intervening-if double-check + LKI snapshot per CR 603.4`

---

### Task 23: Delayed triggers + `pendingDelayed` queue

**Files:** `triggers/delayed-trigger-queue.ts`.

**Failing test:** resolve an effect that creates a delayed trigger firing "at end of turn" → registered in queue; fire `TurnEnded` event → delayed trigger matches, queues as PendingTrigger, removes from delayed queue (if one-shot) or stays (if persistent).

**Impl:**
```ts
export class DelayedTriggerQueue {
  private readonly queue: DelayedTrigger[] = [];
  add(d: DelayedTrigger): void { this.queue.push(d); }
  onEvent(event: GameEvent, sink: TriggerRegistry): void {
    for (let i = this.queue.length - 1; i >= 0; i--) {
      const d = this.queue[i]!;
      if (d.matches(event)) {
        // emit as a pending trigger via the registry
        sink.onEventForcedByDelayed(d, event);
        if (d.oneShot) this.queue.splice(i, 1);
      }
    }
  }
  snapshot(): readonly DelayedTrigger[] { return [...this.queue]; }
}
```

Extend `TriggerRegistry` with `onEventForcedByDelayed(d, event)` (skips `matches`, still runs intervening-if).

**Commit:** `feat(game): add DelayedTriggerQueue with one-shot + persistent support`

---

### Task 24: Linked abilities + trigger suppression

**Files:** `triggers/linked-abilities.ts`; extend `TriggerRegistry`.

**Failing test (linked):** ability A exiles a card with id K attached to its activation-instance; ability B resolves later and references "the exiled card" — reads K from linkage, not from any global LKI.

**Failing test (suppression):** Static ability "triggered abilities don't trigger" active → `TriggerRegistry.register` refuses to queue pending triggers whose source is affected.

**Impl:**
```ts
// linked-abilities.ts
export class LinkedAbilityTable {
  // abilityInstanceId -> { linkedCardId, exileZoneEntryId }
  private readonly table = new Map<EntityId, { readonly linkedCardIds: readonly EntityId[] }>();
  set(instanceId: EntityId, linkedCardIds: readonly EntityId[]): void { this.table.set(instanceId, { linkedCardIds }); }
  get(instanceId: EntityId): readonly EntityId[] { return this.table.get(instanceId)?.linkedCardIds ?? []; }
}

// In TriggerRegistry.onEvent: consult StaticEffectRegistry for suppression
// restrictions; skip registering pending if restricted.
```

Wire `game.linkedAbilities = new LinkedAbilityTable();`.

**Commit:** `feat(game): add linked-ability table + trigger suppression hook (CR 607)`

**Milestone E gate:** full gate green.

---

# Milestone F — Static effect registry

Goal: statics active while source is in its `activeInZones` zone(s); zone-change discipline; layer-contributor dispatch; cost-mod + can't/must/may contributors.

**Forge refs:** `StaticAbility.java`, `StaticAbilityContinuous.java`, `StaticAbilityCantBeCast.java`, `StaticAbilityMustBlock.java`.

---

### Task 25: `StaticEffectRegistry` + zone-activation discipline

**Files:** Create `packages/game/src/statics/{static-effect-registry.ts,zone-activation.ts,index.ts}`; wire `Game.staticEffectRegistry`.

**Failing test:** card with a Static active-in Battlefield; register on `moveTo(Battlefield)`; unregister on `moveTo(Graveyard)`. `onZoneChange` hook on GameAction.moveTo.

**Impl:**
```ts
export class StaticEffectRegistry {
  private readonly byId = new Map<EntityId, StaticAbility>();
  private readonly bySourceCard = new Map<EntityId, EntityId[]>();
  register(s: StaticAbility): void { this.byId.set(s.id, s); const list = this.bySourceCard.get(s.sourceCardId) ?? []; list.push(s.id); this.bySourceCard.set(s.sourceCardId, list); }
  unregister(id: EntityId): void { const s = this.byId.get(id); if (!s) return; this.byId.delete(id); const list = this.bySourceCard.get(s.sourceCardId) ?? []; this.bySourceCard.set(s.sourceCardId, list.filter((x) => x !== id)); }
  all(): readonly StaticAbility[] { return [...this.byId.values()]; }
  byCategory(c: StaticAbility["category"]): readonly StaticAbility[] { return [...this.byId.values()].filter((s) => s.category === c); }
}

export const onZoneChange = (game: Game, cardId: EntityId, from: ZoneType, to: ZoneType): void => {
  const card = game.cards.get(cardId); if (!card) return;
  const intrinsicStatics = getIntrinsicStatics(card);
  for (const s of intrinsicStatics) {
    const wasActive = s.activeInZones.has(from);
    const isActive = s.activeInZones.has(to);
    if (!wasActive && isActive) game.staticEffectRegistry.register(s);
    else if (wasActive && !isActive) game.staticEffectRegistry.unregister(s.id);
  }
  game.layerEngine.bumpEpoch("zone-change-static");
};
```

Modify `GameAction.moveTo` to call `onZoneChange(game, cardId, fromZone, toZone)` after state mutation.

`getIntrinsicStatics(card)` returns the card's Statics from PaperCard.definition (stubbed empty in SP2; SP3 populates).

**Commit:** `feat(game): add StaticEffectRegistry + zone-activation discipline`

---

### Task 26: Layer contributors — connect Statics to LayerEngine

**Files:** `statics/layer-contributors.ts`; modify `layer-engine.ts` to re-pull all continuous Statics on epoch bump.

**Failing test:** register a continuous static that adds `Creature` type in Layer 4 to all permanents you control → `computeCharacteristics(cardId)` for a controlled permanent reflects the type change. Unregister → type gone.

**Impl:** each continuous static contributes a `{ layer, effect }` to LayerEngine's per-layer arrays on register, removes on unregister. `describe()` returns the layer-specific effect struct (TypeChangeEffect / ColorChangeEffect / AbilityChangeEffect / Layer7XEffect / TextSubstitution).

**Commit:** `feat(game): connect continuous Statics to LayerEngine layers`

---

### Task 27: Cost-mod + can't/must/may contributors

**Files:** `statics/cost-mod-contributor.ts`, `statics/cant-must-may.ts`.

**Failing test (cost-mod):** static "your spells cost {1} less" reduces announced cost by 1. Solver integration is SP3; this task wires the registry-side contract.

**Failing test (can't-must-may):** static "attack each turn if able" → decision validator consults registry and marks non-attacking as illegal.

**Impl:**
```ts
export interface CostModEffect {
  readonly filter: (sa: StackItem) => boolean;
  readonly delta: { readonly generic?: number; readonly color?: import("@mtg-forge-ts/core").Color; readonly deltaColor?: number };
}
export interface CantMustMayRestriction {
  readonly kind: "cantCast" | "cantActivate" | "cantAttack" | "mustAttack" | "cantBlock" | "mustBlock" | "cantTarget" | "cantUntap";
  readonly filter: (subjectId: EntityId, game: Game) => boolean;
}

// StaticEffectRegistry#allCostMods(): CostModEffect[];
// StaticEffectRegistry#allRestrictions(): CantMustMayRestriction[];
```

Wire decision validator in `controller/validator.ts` (new file) to consult restrictions.

**Commit:** `feat(game): add cost-mod + can't/must/may static contributors`

---

### Task 28: Replacement-generating + ability-granting statics

**Failing test:** Static "auras you control have 'when this leaves, draw a card'" grants an LTB trigger to each matching aura. When an aura leaves → trigger fires.

**Impl:** replacement-generating statics auto-register a matching ReplacementAbility in `ReplacementRegistry` while active. Ability-granting statics contribute to Layer 6 (AbilityChangeEffect).

**Commit:** `feat(game): add replacement-generating + ability-granting static contributors`

**Milestone F gate:** full gate green.

---

# Milestone G — State-based actions

Goal: CR 704.5 SBA sweep with fixpoint, all ~35 SBA handlers.

**Forge refs:** `GameAction.java#checkStateEffects()`, `Game#checkStateEffects()`.

---

### Task 29: `SbaEngine` skeleton + fixpoint loop

**Files:** Create `packages/game/src/sba/{sba-engine.ts,sba-action.ts,index.ts}`; wire `Game.sbaEngine`.

**Failing test:** engine with no SBAs → `sweep()` returns empty array. Engine with a single SBA that fires once → returns 1-batch array, fires again after state change → subsequent sweep returns another batch.

**Impl:**
```ts
export type SbaAction =
  | { readonly kind: "playerLosesLife0"; readonly seat: PlayerSeat }
  | { readonly kind: "playerLosesPoison"; readonly seat: PlayerSeat }
  | { readonly kind: "playerLosesLibrary"; readonly seat: PlayerSeat }
  | { readonly kind: "creatureToGraveZeroTough"; readonly cardId: EntityId }
  | { readonly kind: "creatureDestroyedLethalDamage"; readonly cardId: EntityId }
  | { readonly kind: "planeswalkerZeroLoyalty"; readonly cardId: EntityId }
  | { readonly kind: "battleExiledZeroDefense"; readonly cardId: EntityId }
  | { readonly kind: "legendRuleChoose"; readonly seat: PlayerSeat; readonly candidateIds: readonly EntityId[] }
  | { readonly kind: "worldRuleOlder"; readonly cardId: EntityId }
  | { readonly kind: "tokenCeaseOffBattlefield"; readonly cardId: EntityId }
  | { readonly kind: "auraInvalidToGrave"; readonly cardId: EntityId }
  | { readonly kind: "equipmentUnattachNonCreature"; readonly cardId: EntityId }
  | { readonly kind: "fortificationUnattachNonLand"; readonly cardId: EntityId }
  | { readonly kind: "countersPairwiseCancel"; readonly cardId: EntityId; readonly plusCount: number; readonly minusCount: number }
  | { readonly kind: "copyInNonBattlefieldRevert"; readonly cardId: EntityId }
  | { readonly kind: "phasedOutOwnerLeaves"; readonly cardId: EntityId }
  | { readonly kind: "sagaSacrificed"; readonly cardId: EntityId }
  | { readonly kind: "classGainLevelCounter"; readonly cardId: EntityId }
  | { readonly kind: "commanderZoneReplacement"; readonly cardId: EntityId }
  | { readonly kind: "bestowAuraReverts"; readonly cardId: EntityId };

export class SbaEngine {
  constructor(private readonly game: Game) {}
  *sweep(): Generator<EngineYield, readonly SbaAction[][], DecisionResponse> {
    const batches: SbaAction[][] = [];
    while (true) {
      const actions = this.collectApplicable();
      if (actions.length === 0) break;
      yield* this.apply(actions);
      batches.push(actions);
      yield { kind: "event", event: mkEvent("StateBasedActionApplied", this.game.turn, this.game.phase, { actionCount: actions.length }) };
    }
    return batches;
  }
  private collectApplicable(): SbaAction[] { /* populated in Tasks 30-32 */ return []; }
  private *apply(actions: readonly SbaAction[]): Generator<EngineYield, void, DecisionResponse> { /* dispatch on kind */ }
}
```

**Commit:** `feat(game): add SbaEngine skeleton with fixpoint sweep (SP2 §2c)`

---

### Task 30: Player-loss + creature/PW/battle removal SBAs

**Failing tests:** life ≤ 0 → loss. Poison ≥ `rules.poisonCountersToLose` → loss. `failedDrawFromEmptyLibrary` flag on Player → loss. Creature with `toughness <= 0` → graveyard. Creature with `damage >= toughness` → destroy (if `indestructible`, no). Planeswalker with 0 loyalty → graveyard. Battle with 0 defense → exile.

**Impl:** collection inside `collectApplicable`. Apply uses `GameAction.moveTo(cardId, Graveyard)` / `exile` / `game.setTerminal` via existing helpers.

**Commit:** `feat(game): implement player-loss + creature/planeswalker/battle SBAs (CR 704.5a-g)`

---

### Task 31: Legend rule + world rule + token/copy/phased cleanup + attachment SBAs

**Failing tests:**
- **Legend:** 2 Legendary permanents same name same controller → owner chooses one to keep; yield `chooseLegendKeeper` decision (add to core decisions union if not present). Others to graveyard.
- **World:** 2 world permanents → the newer (higher timestamp) stays; others leave via world-rule leave event.
- **Token cleanup:** token in a non-battlefield zone → cease to exist.
- **Copy cleanup:** copy in a non-battlefield zone → revert to non-copy (clear `Card.copiedFrom`).
- **Phased-out owner leaves:** leaves game.
- **Aura/Equipment/Fortification:** aura on invalid → graveyard. Equipment on non-creature → unattach. Fortification on non-land → unattach.

**Commit:** `feat(game): implement legend/world/token/copy/phased/attachment SBAs (CR 704.5h-p)`

---

### Task 32: Counter pairwise cancel + Saga + Class + bestowed + commander SBAs

**Failing tests:**
- **Counter cancel:** card with 3 +1/+1 and 2 -1/-1 → 1 +1/+1 remains, 0 -1/-1.
- **Saga:** lore counters ≥ final chapter AND final chapter resolved → sacrifice.
- **Class:** class permanent without level counter → given level-1 counter.
- **Bestow:** aura-bestow in non-battlefield → reverts to creature form.
- **Commander zone replacement:** commander in graveyard/exile with `owner.moveToCommandZone === true` flag → to command zone.

**Commit:** `feat(game): implement counter-cancel + Saga + Class + bestow + commander SBAs (CR 704.5q-v)`

**Milestone G gate:** full gate green.

---

# Milestone H — Continuous effects + duration

### Task 33: `ContinuousEffect` duration evaluator + expiry

**Files:** Create `packages/game/src/continuous/{duration-evaluator.ts,continuous-effect-registry.ts,index.ts}`.

**Failing test:** register a `untilEndOfTurn` continuous effect. `TurnEnded` event → expired. Register `untilXLeavesBattlefield` with x=cardId → `cardId` moveTo(Graveyard) → expired. `permanent` → survives cleanup.

**Impl:**
```ts
export const isExpired = (d: EffectDuration, event: GameEvent | null, game: Game): boolean => {
  switch (d.kind) {
    case "untilEndOfTurn": return event?.kind === "TurnEnded";
    case "untilEndOfYourNextTurn": return event?.kind === "TurnEnded" && event.payload.turn > d.registeredAtTurn; // closed over registration context
    case "untilXLeavesBattlefield": return event?.kind === "CardChangedZone" && event.payload.cardId === d.xId && event.payload.fromZone === ZoneType.Battlefield;
    case "asLongAs": return !evalCondition(d.condition, game);
    case "permanent": return false;
    case "untilCombatEnds": return event?.kind === "CombatEnded";
    case "untilEndOfNextStep": return event?.kind === "PhaseStepEnded" && event.payload.step === d.step;
    default: { const _: never = d; throw new Error(`unreachable ${JSON.stringify(_)}`); }
  }
};
```

Hook: `PhaseHandler` on step/phase/turn end → for each continuousEffect on `game.continuousEffects`, check `isExpired`; if so, unregister from StaticEffectRegistry + remove from list. Emit `ContinuousEffectExpired` event.

**Commit:** `feat(game): add continuous-effect duration evaluator + expiry hook (SP2 §8)`

---

### Task 34: `asLongAs` conditions

**Files:** `continuous/condition-ast.ts`.

**Failing test:** ContinuousEffect with `asLongAs: { kind: "cardHasType", cardId: X, type: Creature }`. Card X has type Creature → active. Layer-engine-driven type strip → no longer active → expired on next SBA sweep.

**Impl:** minimal `ConditionAst` union: `cardHasType`, `cardInZone`, `playerHasLife`, `cardTapped`, `always`. Evaluator walks. SP3 extends.

**Commit:** `feat(game): add asLongAs condition evaluator (SP2 §8)`

**Milestone H gate:** full gate green.

---

# Milestone I — Cast pipeline

Goal: CR 601.2 10-step generator with StackItemProvenance + abort/rollback.

**Forge refs:** `forge-game/src/main/java/forge/game/spellability/SpellAbility.java#cast()`, `Game#castSpell()`.

---

### Task 35: `CastPipeline` skeleton + step enumeration

**Files:** Create `packages/game/src/cast/{cast-pipeline.ts,cast-step.ts,stack-item-provenance.ts,index.ts}`.

**Failing test:** pipeline construction; `.run(proposeParams)` yields 10 decision/event pairs for a no-op happy path.

**Impl:**
```ts
export enum CastStep {
  Propose = 1, ChooseFace, ChooseZoneOverride, ChooseAltCosts, ChooseModes,
  DistributeX, ChooseTargets, DetermineTotalCost, ActivateManaAbilities, PayCosts,
}

export interface CastProposal {
  readonly castingPlayer: PlayerSeat;
  readonly sourceCardId: EntityId;
  readonly originZone: ZoneType;
  readonly asSpecialAction: boolean;
}

export class CastPipeline {
  constructor(private readonly game: Game) {}
  *run(proposal: CastProposal): Generator<EngineYield, StackItem | null, DecisionResponse> {
    const ctx = this.initContext(proposal);
    try {
      yield* this.stepPropose(ctx);
      yield* this.stepChooseFace(ctx);
      yield* this.stepChooseZoneOverride(ctx);
      yield* this.stepChooseAltCosts(ctx);
      yield* this.stepChooseModes(ctx);
      yield* this.stepDistributeX(ctx);
      yield* this.stepChooseTargets(ctx);
      yield* this.stepDetermineTotalCost(ctx);
      yield* this.stepActivateManaAbilities(ctx);
      yield* this.stepPayCosts(ctx);
      return this.finalizeStackItem(ctx);
    } catch (e) {
      yield* this.abort(ctx, e);
      return null;
    }
  }
  // stepXxx methods stubbed in Task 35; filled in Tasks 36-38.
}
```

**Commit:** `feat(game): add CastPipeline skeleton with 10-step generator (SP2 §9)`

---

### Task 36: Steps 1–4 (propose / face / zone / altcost)

**Failing tests:** split card → face choice yields `chooseOption` decision; flashback → zone override sets `ctx.alternativeZoneDestination = Exile`; kicker → `ChooseAltCosts` yields `chooseOptionalCosts` decision.

**Impl:** each step yields a decision if the card shape needs input; otherwise auto-passes. Records choices on `ctx`.

**Commit:** `feat(game): implement cast steps 1-4 (propose/face/zone-override/alt-costs)`

---

### Task 37: Steps 5–7 (modes / distribute-X / targets)

**Failing tests:** modal spell 2-of-4 → `chooseMode` decision accepts exactly 2. X-spell → `chooseNumber` decision for X ≥ 0. Divide-X — e.g., Pyrotechnics → `distributeX` decision; sum matches X. Target choice uses `TargetSystem.validateAtCast`.

**Commit:** `feat(game): implement cast steps 5-7 (modes/distribute-X/targets)`

---

### Task 38: Steps 8–10 (total cost / mana abilities / pay) + `StackItemProvenance`

**Failing tests:** total cost reflects Static cost-mods + replacement-cost-mods. Mana-ability activation step yields `priority` sub-decisions allowing mana-ability activation only. Pay-costs step emits `CostPaid` event once all parts paid. Final StackItem carries `provenance`.

**Impl signature:**
```ts
export interface StackItemProvenance {
  readonly originZone: ZoneType;
  readonly altCostUsed: string | null;
  readonly additionalCostsPaid: readonly string[];
  readonly cascadeOrigin?: EntityId;
  readonly copiedFrom?: EntityId;
  readonly alternativeZoneDestination?: ZoneType;
}
```

Full Pay-Costs impl depends on SP3's CostPart runtime; SP2 wires the CostPayment record (list of `{ costPartId, paidAmount }`) that SP3 can iterate to reverse on abort.

**Commit:** `feat(game): implement cast steps 8-10 + StackItemProvenance`

---

### Task 39: Abort + rollback

**Failing test:** spell cast that fails at step 9 (mana insufficient) → all previously mutated state reverts; `CastAborted` event emitted once. Any replacement "buffered events" list is discarded.

**Impl:** `CastPipeline.abort(ctx, error)` pops each `CostPayment` entry and calls `costPart.undo(game)` (SP3 provides undo; SP2 stubs a default that throws with a message — test with no-cost spells for SP2). Emit `CastAborted`. Restore `ctx.originalZone` placement if card was moved.

**Commit:** `feat(game): implement cast abort + rollback (SP2 §9.abort)`

**Milestone I gate:** full gate green.

---

# Milestone J — Priority orchestrator

### Task 40: `runPriorityWindow` loop

**Files:** Create `packages/game/src/priority/priority-orchestrator.ts`.

**Failing test:** SBA sweep → no SBAs applicable, triggers drain → empty → yields `priority` decision to active player. With SBAs and triggers queued → loops until both empty, then yields.

**Impl:**
```ts
export function* runPriorityWindow(game: Game): Generator<EngineYield, void, DecisionResponse> {
  while (true) {
    let didSomething = false;
    const sbaBatches = yield* game.sbaEngine.sweep();
    if (sbaBatches.length > 0) didSomething = true;
    const pending = game.triggerRegistry.drain();
    if (pending.length > 0) {
      const seats = game.players.map((p) => p.seat);
      const ordered = yield* apnapOrder(pending, game.activePlayer, seats);
      for (const pt of ordered) yield* resolveTrigger(game, pt);
      didSomething = true;
    }
    if (!didSomething) break;
  }
  yield { kind: "decision", request: { kind: "priority", playerSeat: game.activePlayer, legalActions: enumerateLegalActions(game) } };
}
```

**Commit:** `feat(game): add runPriorityWindow orchestrator loop (SP2 §10)`

---

### Task 41: Legal-action enumeration

**Files:** `packages/game/src/priority/legal-action-enumerator.ts`.

**Failing test:** `enumerateLegalActions(game)` returns `[{ kind: "pass" }, ...activatable abilities, ...castable spells]` — castable filtered by zone visibility + restrictions (e.g., sorcery timing).

**Impl:** walk each card in each player's hand/battlefield; for each, consult StaticEffectRegistry restrictions; emit castable/activatable entries.

**Commit:** `feat(game): add legal-action enumeration for priority decisions`

**Milestone J gate:** full gate green.

---

# Milestone K — Attachment subsystem

### Task 42: `Card.attachedTo` / `attachments` + `GameAction.attach` / `unattach`

**Files:** Modify `packages/game/src/card.ts` (already has fields), add `packages/game/src/attachment/attachment-ops.ts` with generator methods on GameAction.

**Failing tests:**
- `attach(auraId, creatureId, "cast")` sets `aura.attachedTo = creatureId` and `creature.attachments` includes auraId; emits `CardAttached`.
- `unattach(auraId)` clears and emits `CardUnattached`.
- Zone-change of attached card → SBA fires detach (handled by Milestone G Task 31).

**Impl:**
```ts
// action/game-action.ts add:
*attach(sourceId: EntityId, targetId: EntityId, cause: "cast" | "static" | "sba"): Generator<EngineYield, void, DecisionResponse> {
  const source = this.game.cards.get(sourceId); const target = this.game.cards.get(targetId);
  if (!source || !target) throw new GameStateIntegrityError("attach: card missing");
  if (source.attachedTo !== null) {
    const prev = this.game.cards.get(source.attachedTo);
    if (prev) prev.attachments = prev.attachments.filter((x) => x !== sourceId);
  }
  source.attachedTo = targetId;
  target.attachments = [...target.attachments, sourceId];
  this.game.layerEngine.bumpEpoch("attach");
  yield { kind: "event", event: mkEvent("CardAttached", this.game.turn, this.game.phase, { sourceId, targetId, cause }) };
}
*unattach(sourceId: EntityId): Generator<EngineYield, void, DecisionResponse> { /* mirror */ }
```

**Commit:** `feat(game): implement attach/unattach on GameAction (SP2 §11)`

---

### Task 43: Layer 6 aura ability granting

**Failing test:** Aura with "enchanted creature has flying" attaches → target's Characteristics.abilities includes flying. Unattach → abilities lose flying.

**Impl:** Aura's Static (in its CardDefinition, SP3-provided; SP2 test uses hand-built Static) contributes an AbilityChangeEffect with target being `attachedTo`. On attach/unattach, re-register/unregister.

**Commit:** `feat(game): wire Layer 6 aura ability granting`

**Milestone K gate:** full gate green.

---

# Milestone L — Ownership vs control + zone routing

### Task 44: Owner-based zone routing

**Failing test:** opponent-controlled card dies → goes to **owner's** graveyard, not controller's. `moveTo(cid, Graveyard)` without explicit `toSeat` routes to `card.ownerSeat`.

**Impl:** modify `GameAction#defaultDestinationSeat` to route personal-zone destinations (Hand, Graveyard, Library) to `card.ownerSeat`, not `fromOwner`. Battlefield destinations stay with `card.controllerSeat`.

**Commit:** `feat(game): route personal-zone destinations to ownerSeat (CR 400.7)`

---

### Task 45: Control-change return + CR 800.4 cleanup

**Failing test:**
- **Temporary control:** `changeControl` with duration → at expiry, control returns to prior owner. Zone stays Battlefield.
- **Game-end:** player leaves game → all permanents they own leave the game (removed from all zones).

**Impl:** extend `changeControl` to accept optional `{ until: EffectDuration }` that registers an expiration hook. Add `packages/game/src/game-end/leave-game.ts` with `removePlayerFromGame(game, seat)`.

**Commit:** `feat(game): add control-change duration + CR 800.4 game-leave cleanup`

**Milestone L gate:** full gate green.

---

# Milestone M — Combat

**Forge refs:** `Combat.java`, `CombatUtil.java`, `DamageAssignmentAI.java` (for damage rules, not AI).

---

### Task 46: `CombatHandler.dealDamage` generator skeleton

**Failing test:** attacker 2/2 vs blocker 2/2 → both deal 2 → both have damage=2 → SBA (next milestone already implemented) destroys both.

**Impl:**
```ts
*dealDamage(isFirstStrikeStep: boolean): Generator<EngineYield, void, DecisionResponse> {
  const allAssignments: Array<{ sourceId: EntityId; targetKind: "creature" | "player" | "planeswalker" | "battle"; targetId: EntityId | PlayerSeat; amount: number; isCombat: true }> = [];
  for (const [attackerId, info] of this.state.attackers) {
    if (!this.isActiveInStep(attackerId, isFirstStrikeStep)) continue;
    const blockers = this.state.blockerOrdering.get(attackerId) ?? [];
    if (blockers.length === 0) {
      allAssignments.push({ sourceId: attackerId, targetKind: defenderKind(info.defender), targetId: defenderId(info.defender), amount: attackerPower(this.game, attackerId), isCombat: true });
    } else {
      const assignments = this.state.damageAssignments.get(attackerId) ?? [];
      for (const a of assignments) allAssignments.push({ sourceId: attackerId, targetKind: "creature", targetId: a.targetId, amount: a.amount, isCombat: true });
    }
  }
  // Simultaneous: single event emitted via GameAction.damage, one per assignment.
  for (const a of allAssignments) yield* this.game.action.damage(a.sourceId, a.targetKind, a.targetId, a.amount, true);
}
```

`isActiveInStep` checks first-strike/double-strike per Task 48.

**Commit:** `feat(game): implement CombatHandler.dealDamage generator (SP2 §6)`

---

### Task 47: Damage assignment (lethal, trample, deathtouch)

**Failing tests:**
- **Lethal to blockers:** 3/3 vs 1/1+2/2 ordered → must assign 1 to first, rest to second. Invalid assignment rejected.
- **Trample:** 5/5 trampler vs 1/1+2/2 → assign 1+2=3 lethal, 2 trample to defender.
- **Deathtouch:** 1/1 deathtouch vs 5/5 → assigning 1 to the 5/5 is lethal per CR 702.2.

**Impl:** `assignDamageForAttacker` validator — given blockers in order + attacker power + keywords, compute the set of legal (minimumLethalByIndex, trampleOverage). Controller decides but SP2 enforces legality via `decision: assignCombatDamage` → validator.

**Commit:** `feat(game): implement damage-assignment validation (lethal + trample + deathtouch)`

---

### Task 48: First-strike split

**Failing test:** first-striker vs non-first-striker → first-striker deals damage in FS step; non-first-striker is dead before regular damage step. Double-strike creature deals damage in both steps.

**Impl:** `CombatHandler.runStep(isFirstStrike)` — iterate `attackers` and `blockers`, filter by `hasFirstStrike || hasDoubleStrike`. Track which creatures already dealt FS damage; in regular step, include non-FS and double-strikers (second strike).

**Commit:** `feat(game): implement first-strike combat split (CR 702.7)`

---

### Task 49: Core combat keywords — first/double strike, protection, ward, menace, flying, reach, skulk

**Files:** `packages/game/src/combat/keywords.ts`.

**Failing tests per keyword:** one each, using the existing `Characteristics.abilities` reference mechanism to mark presence.

**Impl:** each keyword is a boolean check against `Characteristics.abilities` or a Static restriction. Registered via hand-built ability ids in tests.

- First strike: `hasKeyword(id, "first_strike")`.
- Double strike: `hasKeyword(id, "double_strike")`.
- Protection from X: `restrictions.cantTarget({ color: X })` + damage-prevention replacement + attachment restriction + enchant/block restriction.
- Ward N: register a replacement on "targeted by opponent's spell/ability" that countersunless N is paid.
- Menace: block restriction — can't be blocked except by 2+ creatures.
- Flying: block restriction — can only be blocked by flying or reach.
- Reach: block capability — can block flying.
- Skulk: block restriction — can't be blocked by higher-power creatures.

**Commit:** `feat(game): implement core combat keywords (FS/DS/protection/ward/menace/flying/reach/skulk)`

---

### Task 50: Remaining keywords — flanking, banding, ninjutsu, horsemanship, rampage, intimidate, fear, islandwalk family

**Impl per keyword:**
- Flanking: LTB event trigger -1/-1 until EOT on blocker.
- Banding: allows band declaration; controller sets damage order.
- Ninjutsu: activated ability during declare-blockers — `CombatHandler.ninjutsuSwap(unblockedAttackerId, newAttackerFromHand)`.
- Horsemanship: can't be blocked except by horsemanship.
- Rampage N: +N/+N for each blocker beyond the first.
- Intimidate: can't be blocked except by artifact / same-color.
- Fear: can't be blocked except by artifact / black.
- Landwalk (island/swamp/mountain/forest/plains): can't be blocked if defender controls matching land.

**Commit:** `feat(game): implement keywords (flanking/banding/ninjutsu/horsemanship/rampage/intimidate/fear/landwalk)`

---

### Task 51: Battles as defenders + team combat (2HG)

**Failing tests:**
- **Battle:** attacked like PW; damage reduces defense counters; at 0 → exiled, on-defeat ability resolves.
- **Team combat:** defending team's shared life; damage to team.

**Impl:** `DefenderTarget.kind === "battle"` — damage reduces `counters(CounterType.Defense)` via `removeCounter`. `team` mode set via `GameRules.appliedVariants.includes("twoHeadedGiant")` — if set, life pools shared at team level.

**Commit:** `feat(game): implement battles as defenders + team combat (SP2 §6.battles,team)`

**Milestone M gate:** full gate green.

---

# Milestone N — Phasing

### Task 52: `Card.phased` + untap-step toggle + invisibility

**Files:** `packages/game/src/phasing/phasing-ops.ts`.

**Failing tests:**
- At start of controller's Untap step, permanents with `hasKeyword("phasing")` toggle `phased`.
- Phased-out permanent: still on battlefield rules-wise; invisible to targeting, damage, triggers.
- Zone-change while phased-out: first phases in, then zone-changes.

**Impl:**
- Add `phasing-ops.ts` with `phaseOut(cardId)` and `phaseIn(cardId)` generators on `GameAction`.
- Modify `PhaseHandler.onUntapStep` (SP1 location: `phase/phase-handler.ts`) to iterate controller's permanents with phasing keyword and toggle.
- `TargetSystem.enumerate` filters out `phased` cards.
- `TriggerRegistry.onEvent` ignores events with source/target `phased`.
- `GameAction.moveTo` for a phased card: call `phaseIn` first.

**Commit:** `feat(game): implement phasing (CR 702.26)`

**Milestone N gate:** full gate green.

---

# Milestone O — Face-down machinery

### Task 53: `FaceDownState` union + Layer 1 face-down contribution

**Files:** Create `packages/game/src/face-down/{face-down-state.ts,face-down-layer.ts,index.ts}`.

**Failing test:** card with `faceDown.kind = "morph"` → `LayerEngine.computeCharacteristics` returns 2/2 colorless typeless creature, no name, no mana cost (public view). Owner's private view (SP1 View filter) sees the real card.

**Impl:**
```ts
export type FaceDownState =
  | { readonly kind: "none" }
  | { readonly kind: "morph"; readonly cost: ManaCost }
  | { readonly kind: "manifest" }
  | { readonly kind: "foretell"; readonly castableFrom: "exile" }
  | { readonly kind: "disguise"; readonly wardAmount: number }
  | { readonly kind: "cloak" };

export const applyFaceDownOverride = (target: Characteristics, fd: FaceDownState): void => {
  if (fd.kind === "none") return;
  // CR 708.2: face-down is a 2/2 creature with no name, mana cost, subtypes, etc.
  target.name = "";
  target.manaCost = ManaCost.empty();
  target.colorIndicator = null;
  target.supertypes.clear();
  target.types.clear(); target.types.add(CardType.Creature);
  target.subtypes.clear();
  target.colors = ColorSet.empty();
  target.rulesText = "";
  target.power = 2; target.toughness = 2;
  target.loyalty = null; target.defense = null;
  target.abilities = []; // intrinsic abilities stripped
};
```

Wire into `LayerEngine` Layer 1 alongside copy: apply face-down override AFTER copy effects (copy of face-down → still face-down per CR 707.11).

Tighten `Card.faceDown: FaceDownState = { kind: "none" }`.

**Commit:** `feat(game): add face-down state + Layer 1 override (CR 708.2)`

---

### Task 54: Turn-face-up primitives (morph/manifest/foretell/disguise/cloak)

**Files:** `face-down/turn-face-up.ts`.

**Failing tests per kind:**
- Morph: pay morph cost → faceDown ← none; fire `CardTurnedFaceUp` event + trigger.
- Manifest: only if actual is creature → pay actual mana cost → flip.
- Foretell: cast from exile for foretell cost after turn foretold.
- Disguise: pay disguise cost; ward N retained.
- Cloak: pay actual mana cost only if creature; ward.

**Impl:** `GameAction.turnFaceUp(cardId, paidCost)` generator. Emits `CardTurnedFaceUp` with `previousState`.

**Commit:** `feat(game): implement turn-face-up for all face-down kinds (SP2 §12)`

**Milestone O gate:** full gate green.

---

# Milestone P — Copy effects

### Task 55: `CopiableCharacteristics` capture

**Files:** `packages/game/src/copy/capture.ts`.

**Failing tests:**
- Capture from a source's current (layered) Characteristics after Layer 1 — so a copy-of-copy reflects the first copy's post-layer state.
- Capture from token: token's copiable values (if the token is itself a copy, use its source).
- Capture from DFC: use the visible face.
- Capture from face-down card: 2/2 colorless typeless.
- Capture from X-cost spell: X copied as chosen value.

**Impl:**
```ts
export const captureCopiable = (sourceId: EntityId, game: Game): CopiableCharacteristics => {
  const chars = game.layerEngine.computeCharacteristics(sourceId);
  return {
    name: chars.name, manaCost: chars.manaCost, colorIndicator: chars.colorIndicator,
    supertypes: new Set(chars.supertypes), types: new Set(chars.types), subtypes: new Set(chars.subtypes),
    colors: chars.colors, rulesText: chars.rulesText,
    power: chars.power, toughness: chars.toughness,
    loyalty: chars.loyalty, defense: chars.defense,
  };
};
```

**Commit:** `feat(game): implement CopiableCharacteristics capture (CR 707.2)`

---

### Task 56: Layer 1 full integration — token, DFC, face-down edge cases

**Failing tests:** copy a token → result is a token inheriting name. Copy a DFC → single-faced with copied face's characteristics. Copy a face-down creature → 2/2 colorless typeless.

**Impl:** extend `applyLayer1Copy` to consult `card.isToken`, `card.dfcFace`, `card.faceDown` at capture time (already handled by `captureCopiable`); ensure post-capture the target receives the source's state unchanged.

Add `Card.isToken: boolean` field; SP4 token factory sets it.

**Commit:** `feat(game): complete Layer 1 edge cases (token/DFC/face-down copies)`

---

### Task 57: Stack-copy mechanics

**Files:** Modify `packages/game/src/stack/stack.ts` — add `copy(sourceItemId, newController, options)`.

**Failing tests:**
- `stack.copy(id, newSeat, { changeTargets: choices })` → new StackItem pushed with new id, new controller, new targets. `kind === "copy"`, `isCast === false`, no cast triggers fire.
- Copy resolves → ceases; does not zone-change its source card.

**Impl:**
```ts
copy(sourceItemId: EntityId, newController: PlayerSeat, options: { changeTargets?: TargetChoices } = {}): StackItem {
  const source = this.items.find((i) => i.id === sourceItemId);
  if (!source) throw new GameStateIntegrityError(`stack.copy: source ${sourceItemId} not on stack`);
  const id = this.game.newEntityId();
  const copy: StackItem = { ...source, id, controllerSeat: newController, targets: options.changeTargets ?? source.targets, kind: "copy", isCast: false };
  this.items.push(copy);
  return copy;
}
```

Modify `Stack` ctor to take `game: Game` for entity-id allocation; update SP1 callers.

**Commit:** `feat(game): implement stack-copy mechanics (CR 707.10)`

**Milestone P gate:** full gate green.

---

# Milestone Q — Multi-face cards

### Task 58: Split + Aftermath

**Files:** `packages/game/src/multiface/split.ts`, `aftermath.ts`.

**Failing test (split):** card with `faces: [L, R]`; cast L → only L's characteristics on stack; non-stack zones sum both (CR 708). Aftermath: back half castable only from graveyard; exile after resolve.

**Impl:**
- `Card.face: "front" | "back" | "L" | "R"` (union).
- `LayerEngine.deriveBaseCharacteristics` inspects `card.face` to pick the right face.
- `CastPipeline.stepChooseFace` emits `chooseFace` decision for split cards.
- `StackItemProvenance.alternativeZoneDestination = Exile` for aftermath.

**Commit:** `feat(game): implement split + aftermath (SP2 §15.split)`

---

### Task 59: Flip + Transform DFC + Modal DFC

**Failing tests:**
- Flip (Kamigawa): `Card.flipped: boolean`; flip event swaps to flipped face.
- Transform DFC: `Card.transformed: boolean`; werewolf transforms on day/night.
- Modal DFC: cast either face from hand; the face you cast is what enters; no transformation.

**Impl:** add face fields; `transform(cardId)` generator on GameAction; LayerEngine picks face by flag.

**Commit:** `feat(game): implement flip + transform DFC + modal DFC (SP2 §15.flip/DFC/MDFC)`

---

### Task 60: Adventure + Meld

**Failing tests:**
- Adventure: cast as adventure from hand; on resolve, exile with "may cast this as a creature spell" permission recorded.
- Meld: two specific named cards physically combine; third-face characteristics defined on meld card script.

**Impl:**
- Adventure: `StackItem.adventureMode: boolean`; resolution moves source to Exile with a flag; later cast from exile allowed per permission.
- Meld: `GameAction.meld(cardIdA, cardIdB)` generator creates a new melded permanent (or flips slots); requires test-harness meld script.

**Commit:** `feat(game): implement adventure + meld (SP2 §15.adventure/meld)`

---

### Task 61: Mutate + Host+Augment

**Failing tests:**
- Mutate: stack creatures; host + mutating share one permanent; merged abilities = union.
- Host+Augment (Unstable): augment attaches to host; combined characteristics.

**Impl:**
- `Card.mutatedPile: EntityId[]` top-to-bottom.
- Characteristics.abilities = union across pile; P/T from topmost.
- Augment: `GameAction.combine(hostId, augmentId)` generator.

**Commit:** `feat(game): implement mutate + host+augment (SP2 §15.mutate/host)`

**Milestone Q gate:** full gate green.

---

# Milestone R — The Ring

### Task 62: Ring state + temptation

**Files:** `packages/game/src/ring/{ring-state.ts,temptation.ts,index.ts}`.

**Failing tests:**
- Ring state: `game.ringState[seat] = { bearer: EntityId | null, level: 0..4 }`.
- Temptation: `RingTempts(seat)` event increments level (clamped at 4); may change bearer (yield `chooseRingBearer` decision).

**Impl:**
```ts
export interface RingState { readonly bearer: EntityId | null; readonly level: 0 | 1 | 2 | 3 | 4; }
export function* tempt(game: Game, seat: PlayerSeat): Generator<EngineYield, void, DecisionResponse> {
  const rs = game.ringState.get(seat) ?? { bearer: null, level: 0 };
  const newLevel = Math.min(4, rs.level + 1);
  const newBearer = yield* chooseBearer(game, seat, rs.bearer);
  game.ringState.set(seat, { bearer: newBearer, level: newLevel as 0|1|2|3|4 });
  game.layerEngine.bumpEpoch("ring-tempt");
  yield { kind: "event", event: mkEvent("RingTempted", game.turn, game.phase, { seat, level: newLevel }) };
}
```

**Commit:** `feat(game): add ring state + temptation mechanic`

---

### Task 63: Level-based ability grants

**Failing tests:**
- Level 1: bearer legendary + can't be blocked by greater-power.
- Level 2: whenever bearer attacks, -1/-1 to each other target player's creature until EOT.
- Level 3: whenever bearer deals combat damage, opponent loses 3 life.
- Level 4: whenever bearer attacks, +1/+1 + can't be countered / targeted.

**Impl:** Game-level Static effect that inspects `game.ringState`, contributes Layer 6 ability grants + triggers to the current bearer. Re-register on any epoch bump that could change bearer/level.

**Commit:** `feat(game): implement Ring level 1-4 ability grants (SP2 §16)`

**Milestone R gate:** full gate green.

---

# Milestone S — Turn queue + phase sequence (extra/skipped)

### Task 64: `TurnQueue.pushExtra` / `injectSkip`

**Files:** Modify `packages/game/src/phase/turn-queue.ts`.

**Failing tests:**
- `pushExtra({ activePlayer: seat0 })` → next turn is the extra; followed by original next turn.
- `injectSkip(1)` → next turn is skipped.

**Impl:** `TurnQueue` already a list; add `pushExtra(turn)` (push front), `injectSkip(n)` (insert n skip markers).

**Commit:** `feat(game): add extra-turn + skip-turn primitives on TurnQueue`

---

### Task 65: `PhaseSequence.injectExtraCombat` / `skipStep`

**Files:** Modify `packages/game/src/phase/phase-sequence.ts`.

**Failing tests:**
- `injectExtraCombat()` during current turn → another combat phase (begin/declare-attackers/declare-blockers/damage/end) inserted after current.
- `skipStep(PhaseStep.Draw)` → next draw step elided.

**Impl:** PhaseSequence as a list of PhaseStep; `injectExtraCombat` inserts a subsequence; `skipStep` marks by step kind.

**Commit:** `feat(game): add injectExtraCombat + skipStep on PhaseSequence`

**Milestone S gate:** full gate green.

---

# Milestone T — Loop detection hook

### Task 66: `GameAction.requestShortcut` primitive

**Files:** `packages/game/src/loop/loop-shortcut.ts`.

**Failing test:** `requestShortcut({ description, result })` with valid result → applies and emits `ShortcutApplied`. Invalid → throws `IllegalDecisionError`.

**Impl:**
```ts
export interface LoopResult { readonly finalState: unknown; readonly loopCount: number; readonly description: string; }
export function* requestShortcut(game: Game, description: string, result: LoopResult): Generator<EngineYield, void, DecisionResponse> {
  if (!validateShortcut(description, result)) throw new IllegalDecisionError(`invalid shortcut: ${description}`);
  applyShortcutResult(game, result);
  yield { kind: "event", event: mkEvent("ShortcutApplied", game.turn, game.phase, { description, loopCount: result.loopCount }) };
}
// validateShortcut + applyShortcutResult: SP2 provides the plumbing; actual loop detection is SP5 AI.
```

**Commit:** `feat(game): add requestShortcut engine primitive (SP2 §18)`

---

# Milestone U — Resolve-time decisions

### Task 67: Generator-based `Effect.resolve` contract

**Files:** `packages/game/src/resolve/effect-resolve.ts`, modify `stack/stack-item.ts`.

**Failing test:** hand-built effect with `resolve()` that yields a `chooseOption("yes"|"no")` decision; on yes → `drawCards(2)`, on no → nothing. Stack resolver pops item, invokes resolve, propagates yields.

**Impl:**
```ts
// stack-item.ts add:
export interface StackItemResolver {
  resolve(game: Game): Generator<EngineYield, void, DecisionResponse>;
}
export interface StackItem { /* existing fields */; readonly resolver: StackItemResolver | null; }

// resolve/effect-resolve.ts
export function* resolveStackItem(game: Game, item: StackItem): Generator<EngineYield, void, DecisionResponse> {
  if (item.resolver) yield* item.resolver.resolve(game);
  yield { kind: "event", event: mkEvent("StackItemResolved", game.turn, game.phase, { stackItemId: item.id }) };
  // Zone-change the source card per provenance (usually to owner's graveyard).
  if (item.kind === "copy") return; // copies cease; no zone change.
  const dest = item.provenance?.alternativeZoneDestination ?? ZoneType.Graveyard;
  yield* game.action.moveTo(item.sourceCardId, dest);
}
```

**Commit:** `feat(game): add resolve-time decision contract for StackItem (SP2 §20)`

**Milestone U gate:** full gate green.

---

# Milestone V — Game-end flow + terminal state enrichment

### Task 68: CR 800.4 cleanup + terminal reason taxonomy

**Files:** Modify `packages/game/src/end/end-game.ts`, `terminal-state.ts`.

**Failing tests:**
- Player loses → CR 800.4 cleanup (their cards leave the game).
- `TerminalState` now stores reason union: `"lifeLoss" | "poisonLoss" | "libraryLoss" | "concede" | "drawn"` per loser.

**Impl:**
```ts
// terminal-state.ts
export type LossReason = "lifeLoss" | "poisonLoss" | "libraryLoss" | "concede" | "tenPoison" | "gameDrawn" | "commanderDamage" | "antePaid";
export interface TerminalState {
  readonly outcome: "win" | "draw";
  readonly winnerSeats: readonly PlayerSeat[];   // empty for draw
  readonly losses: readonly { readonly seat: PlayerSeat; readonly reason: LossReason }[];
  readonly endedAtTurn: number;
  readonly endedAtPhase: PhaseStep;
}
```

Extend `endGame(game, reasons)` to mark terminal + cleanup each losing player's cards via `removePlayerFromGame`.

**Commit:** `feat(game): enrich terminal state with loss reasons + CR 800.4 cleanup`

**Milestone V gate:** full gate green.

---

# Milestone W — SP1-audit deferred cleanup

### Task 69: `GameAction.scry` / `surveil` full implementation

**Failing tests:**
- scry(seat, 2): reveals top 2 library cards to owner; yield `orderCardsOnTop` decision for remaining 2 (top-or-bottom partition); emits `CardScried` per card.
- surveil(seat, 2): similar but choice is top or graveyard.

**Impl:** each is a generator: pop top N, yield decision, route back per choice. Consume `game.rng`? No — scry doesn't shuffle.

**Commit:** `feat(game): implement scry + surveil generators (SP1 deferral)`

---

### Task 70: `GameAction.proliferate`

**Failing test:** proliferate → for each permanent/player with 1+ counters, choose to add one of the same kind. Yield `chooseProliferateTargets` decision.

**Impl:** enumerate counter-bearers; yield decision with legal list; for each chosen target, `addCounter(target, counterType, 1)`.

**Commit:** `feat(game): implement proliferate (SP1 deferral)`

---

### Task 71: `createToken` / `createEmblem` factories

**Files:** `packages/game/src/action/token-factory.ts`, `emblem-factory.ts`.

**Failing tests:**
- createToken({ paperCard: goblinToken, controller, count: 3 }) → 3 tokens enter battlefield; each is a distinct Card with `isToken: true`.
- createEmblem({ ownerSeat, abilities }) → emblem Card in Command zone with only the granted abilities.

**Impl:**
```ts
*createToken(params: { paperCard: PaperCard; controller: PlayerSeat; count: number; isCopy?: boolean; copyOf?: EntityId }): Generator<EngineYield, readonly EntityId[], DecisionResponse> {
  const ids: EntityId[] = [];
  for (let i = 0; i < params.count; i++) {
    const id = this.game.newEntityId();
    const card = new Card(id, params.paperCard, params.controller, params.controller, ZoneType.Battlefield);
    card.isToken = true;
    if (params.isCopy && params.copyOf) card.copiedFrom = captureCopiable(params.copyOf, this.game);
    this.game.cards.set(id, card);
    this.game.getPlayer(params.controller).zones.get(ZoneType.Battlefield)?.add(id);
    this.game.layerEngine.bumpEpoch("token-create");
    yield { kind: "event", event: mkEvent("TokenCreated", this.game.turn, this.game.phase, { tokenId: id, controller: params.controller, name: params.paperCard.name ?? "Token" }) };
    ids.push(id);
  }
  return ids;
}
```

`createEmblem`: similar; zone = CommandZone; `Card.isEmblem: boolean` added.

Add `Card.isToken: boolean = false; isEmblem: boolean = false;`

**Commit:** `feat(game): implement token + emblem factories (SP1 deferral)`

---

### Task 72: Opening-hand actions + companion declaration hook

**Files:** `packages/game/src/setup/opening-hand-actions.ts`, `companion-declaration.ts`.

**Failing tests:**
- **Opening-hand actions:** Leyline of the Void in opening hand → controller may reveal + put onto battlefield. Gemstone Caverns → reveal, exile, one counter.
- **Companion:** during setup, yield `companionDeclaration` decision before first mulligan; recorded in `game.companions[seat]`. SP6 plugs in format-level companion validator; SP2 stores the declaration.

**Impl:** extend `setupGame` to emit `openingHandAction` decision if any card in hand has an `openingHandAction: true` flag; emit `companionDeclaration` at the start of setup before any mulligan.

**Commit:** `feat(game): implement opening-hand actions + companion declaration hook (SP1 deferral)`

---

### Task 73: `RandomLegalController` full 44-kind coverage

**Files:** Modify `packages/game/src/controller/random-legal-controller.ts`.

**Failing test:** for each of the 44 `PlayerDecisionKind`s, `RandomLegalController.decide(req)` returns a valid response using `game.rng`.

**Impl:** add a dispatch table mapping each kind → default strategy (e.g., `chooseNumber` → random in [min,max]; `orderTriggers` → `rng.shuffle(list)`; `chooseColor` → random from `game.rng`).

**Commit:** `feat(game): add RandomLegalController coverage for all 44 decision kinds (SP1 deferral)`

---

### Task 74: `GameFlags` per-turn tracking + `Card.remembered` snapshot

**Files:** Modify `packages/core/src/game-flags.ts` (or wherever); `packages/game/src/game-flags.ts`; `snapshot/game-snapshot.ts`.

**Failing tests:**
- `GameFlags.countersAddedThisTurn: Map<EntityId, number>` incremented by `addCounter`; reset on turn end.
- `GameFlags.leftBattlefieldThisTurn: Set<EntityId>` populated by `moveTo` out of Battlefield; reset on turn end.
- `GameFlags.topLibsCast: Set<EntityId>` populated by cast from top-of-library (miracle etc.); reset on turn end.
- `Card.remembered: EntityId[]` (+imprinted) survives snapshot round-trip.

**Impl:** extend GameFlags with the three fields + reset in PhaseHandler turn-end. Modify `GameAction.addCounter` / `moveTo` to push. Extend snapshot.

**Commit:** `feat(game): add GameFlags per-turn tracking + Card.remembered snapshot (SP1 deferral)`

**Milestone W gate:** full gate green.

---

# Milestone X — Snapshot v6 + integration + property + audit

### Task 75: GameSnapshot schemaVersion 5 → 6

**Files:** Modify `packages/game/src/snapshot/game-snapshot.ts`.

**Failing test:** round-trip a Game with populated layer contributors, pending triggers, delayed triggers, static effects, continuous effects, ring state, combat state (non-null now), card-remembered. Assert deep equality post-restore.

**Impl:** bump `schemaVersion: 6`. Add serialization slots for:
- `layerEngine` state: textSubstitutions, typeEffects, colorEffects, abilityEffects, pt7a..7e.
- `staticEffectRegistry`: array of StaticAbility snapshots.
- `triggerRegistry`: byId + pending + delayed.
- `replacementRegistry`: byId.
- `ringState`: per-seat entries.
- `combatState`: the already-reserved slot (populate now).
- `cardRemembered`: per-card id → EntityId[] (was reserved in SP1).

Each registry exposes `toJSON()` / `fromJSON(game, data)`. Provide migration path from schema 5 (empty fields default).

**Commit:** `feat(game): bump GameSnapshot to v6 with SP2 rules-subsystem state`

---

### Task 76: Integration test — full combat scenario

**Files:** `packages/game/src/test/integration/combat-scenario.test.ts`.

**Scenario:** Active player attacks with a 3/3 first-striker and a 2/2 trampler at opponent. Opponent blocks first-striker with two 1/1s and trampler with a 2/2. After combat:
- First-striker: kills both 1/1s in FS step; both unblock. Wait — first-striker blocks remain. Each 1/1 dies FS step; trampler deals 2 damage to blocker (lethal) + 0 trample (since blocker also 2 tough) → trampler survives.
- Life totals, counter counts, graveyard contents asserted.

Use `RandomLegalController` seeded + `ScriptedController` for attacker/blocker choices.

**Commit:** `test(game): integration — full combat scenario (FS + trample)`

---

### Task 77: Integration test — stack + replacements + triggers end-to-end

**Scenario:** Player A casts Lightning Bolt at Player B (3 damage). Player B controls an Angel with "prevent next 3 damage to you" static-replacement. Bolt → replacement prevents → `EventPrevented`. Player A casts a second Bolt → lands this time. Opponent's Soul Warden triggers "whenever a creature enters, you gain 1 life" — not relevant here, but wire a simpler "whenever you're dealt damage, draw a card" trigger to verify trigger ordering post-bolt resolution.

**Commit:** `test(game): integration — stack/replacements/triggers end-to-end`

---

### Task 78: Property tests + 4-reviewer ultrathink audit

**Property tests:**
- SBA sweep terminates (fast-check: random applicable actions → sweep always reaches fixpoint in ≤ N iterations, N = |cards| * 4).
- Layer engine idempotent under repeated `computeCharacteristics` with same epoch.
- Stack LIFO: push N items, pop N → reverse of push order.
- Replacement one-apply: fast-check random replacements → each id in `applied` set appears at most once.

**Audit:** dispatch 4 fresh reviewer subagents (ultrathink, highest scrutiny) examining:
1. **Backend correctness** — layer engine CR compliance, SBA exhaustiveness, replacement/trigger CR 603/614/616 adherence.
2. **Forge data parity** — every registry/state field either maps to Forge or is documented as a deliberate deviation.
3. **Spec gaps** — every SP2 phase 2a-2w covered; each deferred item from SP1 plan resolved or re-deferred with reason.
4. **Test quality** — every `toBeDefined` replaced with structural assertion; every throw path tested; property tests actually cover invariants; no tautologies.

Each reviewer produces a Critical / Important / Nit findings list. Critical + Important get fixed immediately (follow SP1's 4-round remediation pattern). Nits triaged and either fixed or added to deferred list in plan.

**Commit (per reviewer):** `docs(audit): record SP2 reviewer-N findings + remediation`
**Final commit:** `chore(audit): SP2 4-reviewer audit complete + remediation landed`

**Milestone X gate (final SP2 gate):** `pnpm -r typecheck && pnpm -r test && pnpm -r build && pnpm biome check .` all green; test count > 1100 (780 SP1 + ~350 new SP2 tests); no `.skip` / `.todo`.

---

## Post-SP2 deferrals (carry to SP3+)

These stay deferred — SP3 picks them up:

- **CostPart runtime** (`canPay` / `pay` / `undo`) — Tasks 38, 39 depend on SP3 for real mana cost.
- **ManaCostSolver + mana cost-to-pool matching**.
- **DSL parser + 423 concrete ability handlers** — SP3's primary scope.
- **Card.definition resolution from CardDb** — SP4.
- **GameCopier for simulation** — SP5.
- **Format-specific rules** — SP6.
- **Sideboard flow** — SP7.

The plan's X78 audit may surface additional deferrals per reviewer — record in the post-SP2 deferrals appendix at audit time.

---

## Execution

**Plan complete and saved to `docs/superpowers/plans/2026-04-23-sp2-rules-systems.md`.**

**Execution:** `superpowers:subagent-driven-development` — fresh subagent per task + two-stage review, per user's standing "autonomous mode" directive. Ultrathink on every subagent; strict per-task review on logic-heavy tasks (Tasks 9, 17, 18, 19, 22, 26, 29, 32, 35–39, 40, 46–50, 55, 57, 67, 75). Mechanical similar-shape groups eligible for batched dispatch (per-layer tasks 3–8; per-SBA groups within tasks 30–32; per-keyword groups within 49–50; per-multi-face-kind 58–61; per-deferred-item 69–74).

At milestone boundaries, the executor runs the full gate and **only advances** when all checks pass. Post-Task-78 audit mirrors SP1's 4-reviewer ultrathink pattern.

---

## SP2 implementation complete

**Date landed:** 2026-04-23. **Branch:** `sp1-engine-foundations`. Final gate all green:

- `pnpm -r typecheck` — pass (core + game)
- `pnpm -r test` — 626 core + 1174 game = **1800 tests** passing, 0 skipped / todo
- `pnpm -r build` — dist outputs generated for core + game
- `pnpm biome check .` — clean (0 errors, 0 unused-suppression warnings)

### Milestone X (Tasks 75-78) summary

- Task 75: GameSnapshot v6 — SP2-scoped rules-subsystem state (triggers, replacements, continuous effects, ledgers) survive the snapshot round-trip.
- Task 76: full-combat-scenario integration — FS + trample + deathtouch damage pipeline end-to-end.
- Task 77: stack+replacements+triggers integration — prevention replacement consumed, cast trigger drew a card, second bolt lands.
- Task 78: property tests (SBA termination, layer idempotency, stack LIFO, replacement one-apply) + remediation of 5 audit findings from Tasks 76-77:
  1. `GameAction.damage` now deducts `Player.life` on player-target damage and emits a companion `LifeChanged` event.
  2. CR 702.2b deathtouch: any nonzero damage from a deathtouch source tags the target (`Card.damagedByDeathtouch`) so the SBA creature-removal collector destroys it even when damage < toughness. Flag clears on leave-battlefield.
  3. `CastPipeline.run` emits the canonical `SpellCast` event via `game.emitEvent` after `finalizeStackItem` so cast triggers fire.
  4. `runPriorityWindow` now copies a `resolver` (duck-typed off the source `TriggeredAbility`) onto pushed triggered stack items so Task 67's resolver can drive the body; also carries `event` onto the StackItem for resolve-time intervening-if re-check.
  5. `resolveStackItem` pops the resolved slot itself (id-based `popStackItemById` helper); callers no longer need manual `stack.pop()` calls.

### Deferred to SP3+

Items intentionally out of SP2 scope and carried forward:

- **Mana cost solver + CostPart runtime** (`canPay` / `pay` / `undo`) — CastPipeline step 8-10 still stub receipts; SP3's `ManaCostSolver` lands the real resolution.
- **Full ability DSL + ~423 concrete ability handlers** — SP3's primary scope. SP2 hand-stamped resolvers on triggers in tests; real cards cannot yet cast through the pipeline end-to-end until the DSL lands.
- **Keyword registry** — SP2 uses `Card.keywords: Set<string>` ad-hoc for deathtouch / first-strike / trample. SP3 replaces with layered keyword grants sourced off Characteristics (also unblocks indestructible short-circuit in creature-removal SBA).
- **Card.definition-driven characteristics derivation** — SP2 uses `DEFAULT_PAPER_CARD_FLAGS` + hand-populated layer effects in tests; SP4's CardDb hydration drives real P/T / types / mana cost off PaperCard.definition.
- **GameCopier for AI simulation** — SP5.
- **Format-specific rules** — SP6.
- **Sideboard / mulligan variants** — SP7.
- **4-reviewer final SP2 audit** — the X78 plan calls for a dedicated reviewer pass (backend correctness / Forge parity / spec gaps / test quality). Intentionally deferred to a fresh session with clean context so reviewers can exercise full scrutiny. Track as first task of SP3 kickoff.

Minor known-deviation notes carried over:

- Priority orchestration advances only the active player per window; non-active-seat rotation between pushes lands in the SP3 driver loop (Milestone S continuation).

### Snapshot v6 Option A — explicit scope

SP2 Milestone X (Task 75) shipped GameSnapshot v6 under Option A: durable rules-subsystem **data** round-trips, but callable closures / predicate functions do not. The following state is NOT round-tripped today — callers restoring a snapshot must rehydrate from card definitions / cast provenance:

- `ReplacementRegistry` live entries (`apply` / `matches` closures)
- `TriggerRegistry` matchers (`matches` / `captureLki` / `interveningIf` closures) — the pending-trigger entries round-trip, but the backing `TriggeredAbility` does not
- `StaticEffectRegistry` entries (each static carries an `apply` closure)
- `DelayedTriggerQueue` live entries (`matches` closure + any delayed-trigger-specific hooks)
- `StackItem.resolver` — the per-item resolver function; resolve path reads it off a parallel rehydration shim in tests
- `Card.intrinsicStatics` — per-card static-ability arrays seeded at card construction
- `Combat` state slot (`attackers` / `blockers` / `blockerOrdering` / `damageAssignments` / `firstStrikeSplitActive`)
- `ConditionAst` evaluators that reference captured closures
- Per-turn `topLibsCast` population — cast-pipeline does not yet populate this ledger

SP3 ships Option B: an `AbilityRegistry` keyed by stable ability ids. Serialized snapshots will carry id references; rehydration looks the closure up in the registry. That pathway is NOT available in SP2 because the ability DSL hasn't landed.

### Deferred to SP3+

Items intentionally out of SP2 scope and carried forward:

- **Mana cost solver + CostPart runtime** (`canPay` / `pay` / `undo`) — CastPipeline step 8-10 still stub receipts; SP3's `ManaCostSolver` lands the real resolution.
- **Full ability DSL + ~423 concrete ability handlers** — SP3's primary scope. SP2 hand-stamped resolvers on triggers in tests; real cards cannot yet cast through the pipeline end-to-end until the DSL lands.
- **Keyword registry** — SP2 uses `Card.keywords: Set<string>` ad-hoc for deathtouch / first-strike / trample / indestructible (audit remediation Round 1 added the indestructible short-circuit via this set). SP3 replaces with layered keyword grants sourced off Characteristics.
- **Card.definition-driven characteristics derivation** — SP2 uses `DEFAULT_PAPER_CARD_FLAGS` + hand-populated layer effects in tests; SP4's CardDb hydration drives real P/T / types / mana cost off PaperCard.definition.
- **GameCopier for AI simulation** — SP5.
- **Format-specific rules** — SP6.
- **Sideboard / mulligan variants** — SP7.

Behavioral gaps carried forward (discovered during implementation + audit):

- **Day/Night + Daybound/Nightbound** — CR 726 daytime tracking, keyword-driven transforms. No day flag on Game today.
- **Shadow keyword** — CR 702.27 evasion; needs block-restriction integration (symmetric to flying but with its own pairing rule).
- **TurnBasedAction framework** — explicit per-step scheduler that fires untap / upkeep / draw / begin-combat / etc. as first-class actions, not hardcoded in the phase handler.
- **Banding multi-attacker block check** — attacker-side banding (CR 702.22h) where a single banded attacker can be blocked across multiple attackers' damage distribution.
- **Team-combat damage routing** — damage to a player on a shared-life team (2HG) should deduct the team's shared life, not the player's individual life slot.
- **`choosePlayer` with min > 0 fallback** — ensure callers with required-count get a valid fallback seat when all candidates are filtered out (today throws).
- **`chooseDungeon` + `chooseManaReplacement` decision kinds** — event-taxonomy slots exist; decision handlers do not.
- **Missing events**: `LandPlayed`, `ClassLevelGained`, `DoorChanged`, `PlayerCounters`, `CombatUpdate`. Emit sites need wiring in GameAction / phase handler / CombatHandler.
- **`topLibsCast` population** — cast-pipeline has no call site; adds to provenance but never actually appends to the ledger.
- **4-reviewer final SP2 audit** — shipped Round 1; a possible Round 2 (forge-parity + remaining Important items) is tracked as SP3 kickoff work.
