# SP3 — DSL Parser + Effects Library

**Status:** Design approved
**Date:** 2026-04-23
**Packages:** `@mtg-forge-ts/cards` (parser + structural validator), `@mtg-forge-ts/game` (handler classes + runtime dispatch)
**Prerequisites:** SP1 (engine foundations), SP2 (rules systems scaffolding)

---

## Purpose

Build the machinery that turns Forge card scripts (vendored `.txt` files) into runnable abilities. This sub-project covers:

- The DSL parser (tokenizer, line parsers, AST assembler, structural validator).
- The semantic validator (separate tool, consumes game's registries).
- 204 `SpellAbilityEffect` classes.
- 139 `TriggerHandler` classes.
- 46 `ReplacementHandler` classes.
- 34 `KeywordHandler` classes.
- ~30 `CostPart` classes (effect-side; core carries data types).
- SVar evaluator.
- Alternative / additional cost registry.
- Cross-card reference resolution.

After SP3, any individual vendored card `.txt` file can be loaded, parsed, and, when its handlers are present, played end-to-end. SP4 then ingests the full 32k database with validator coverage.

## 1. Forge DSL overview

Card scripts are line-oriented text, one card per file. Each line has a prefix; everything after the prefix is pipe-separated key-value pairs.

### Known prefixes

| Prefix | Meaning |
|---|---|
| `Name:` | Card name |
| `ManaCost:` | Mana cost (space-separated symbols) |
| `Types:` | Supertypes / types / subtypes |
| `PT:` | Power/Toughness |
| `Loyalty:` | Starting loyalty |
| `Defense:` | Starting defense (battles) |
| `Colors:` | Explicit color override |
| `A:` | Activated or Spell Ability (`AB$` or `SP$` or `DB$`) |
| `T:` | Triggered Ability (`Mode$ X`) |
| `R:` | Replacement Effect (`Event$ X`) |
| `S:` | Static Ability (`Mode$ X`) |
| `K:` | Keyword (`K:Flying`, `K:Kicker:2 R`, etc.) |
| `SVar:` | Script variable |
| `DeckHas:` / `DeckHints:` / `DeckNeeds:` | AI deck-building metadata |
| `AI:` | AI deck/play hints |
| `AlternateMode:` | Multi-face indicator |
| `Text:` | Supplementary text |
| `Rules:` | Rules-text reference |
| `Oracle:` | Oracle text (unparsed, display-only) |
| `HandLifeModifier:` | Commander partner specifics |

Complete prefix list is determined by first upstream sync; parser rejects unknown prefixes as errors unless tagged with `@tolerate-unknown` (for experimental new mechanics during sync pre-review).

### Ability dispatch keys

- `SP$ <X>` — spell ability handler key `X`.
- `AB$ <X>` — activated ability handler key `X`.
- `DB$ <X>` — dependent (sub-) ability handler key `X`.
- `Mode$ <X>` — trigger mode or static ability mode.
- `Event$ <X>` — replacement event kind.

Handler keys are string identifiers matching class names in `@mtg-forge-ts/game/src/{ability,trigger,replacement,keyword}/handlers/`.

## 2. Parser architecture (`@mtg-forge-ts/cards/src/parser/`)

Five stages:

### 2.1 Lexer

Reads the raw file, produces a stream of tagged lines:

```ts
interface LexedLine {
  lineNumber: number;
  prefix: string;                          // "A", "T", "K", "SVar", "Name", etc.
  content: string;                         // rest of line
  tokens: Array<Map<string, string>>;      // pipe-separated, each with $-split key/value
}
```

Handles escape sequences (`\|`), preserves whitespace inside values but trims ends.

### 2.2 Line parsers

Per-prefix:
- `parseNameLine(content): string`
- `parseManaCostLine(content): ManaCostAst`
- `parseTypeLine(content): TypeLineAst`
- `parseAbilityLine(content, lineNumber): AbilityAst`  // handles SP$/AB$/DB$
- `parseTriggerLine(content, lineNumber): TriggerAst`
- `parseReplacementLine(content, lineNumber): ReplacementAst`
- `parseStaticLine(content, lineNumber): StaticAst`
- `parseKeywordLine(content, lineNumber): KeywordAst`
- `parseSVarLine(content, lineNumber): { name: string; expr: SVarAst }`
- `parseAiLine(content, lineNumber): AiHintAst`

Each parser emits an AST node with source location (for error reporting).

### 2.3 AST assembler

Combines parsed lines into a `CardDefinition`:

```ts
interface CardDefinition {
  name: string;
  manaCost: ManaCostAst | null;
  colors: ColorSet | null;                 // from Colors: line or inferred from mana
  types: TypeLineAst;
  pt?: PtAst;
  loyalty?: LoyaltyAst;
  defense?: DefenseAst;
  abilities: AbilityAst[];
  triggers: TriggerAst[];
  replacements: ReplacementAst[];
  statics: StaticAst[];
  keywords: KeywordAst[];
  svars: Map<string, SVarAst>;
  aiHints: AiHintAst[];
  faces?: CardDefinition[];                // for multi-face (split, DFC, etc.)
  oracle: string;
  rulesText: string;                       // canonical for engine layer-3 input
  source: { file: string; forgeSha: string };
}
```

Resolves intra-card references:
- `SubAbility$ DBX` → links to `SVar:DBX` entry.
- `SVar$ X` in a param → links to `SVar:X` entry.

### 2.4 Structural validator (ships with `@mtg-forge-ts/cards`)

Checks that pass without game-side registry:
- Every `$`-keyword looks like a valid identifier.
- Required params present per each handler key's schema (schemas shipped alongside card data as `dsl-schemas.json`, maintained manually during handler development).
- Every `SVar$` reference resolves to a defined SVar on the card.
- Every `SubAbility$` reference resolves.
- Type-compatible param values (numeric fields parse as numbers or SVar expressions; zone fields are valid zone names).
- Mana cost tokens are valid symbol identifiers.

Does NOT check: handler key is registered (requires game package).

### 2.5 Semantic validator (in `tools/dsl-validator/`, not a published package)

Imports from both `@mtg-forge-ts/cards` and `@mtg-forge-ts/game`. Runs in CI only.

- Every handler key is registered (`EffectRegistry.has`, `TriggerRegistry.has`, etc.).
- Every AI: hint references a known AI behavior keyword.
- Cross-card references (token names, named-card references) resolve.

## 3. DSL AST types (in `@mtg-forge-ts/core`)

Defined in core so both `cards` (producer) and `game`/`ai` (consumer) can import without cross-package dependency.

### ParamValue

```ts
type ParamValue =
  | { kind: "literal"; raw: string }
  | { kind: "svarRef"; name: string }
  | { kind: "expression"; ast: SVarExpressionAst };
```

Parser determines the shape by conventions:
- Uppercase single-letter tokens (X, Y, Z) → svarRef.
- `$`-prefixed compound (e.g., `Count$xPaid`) → expression.
- Otherwise → literal.

### EffectInvocation

```ts
interface EffectInvocation {
  handlerKey: string;
  params: Map<string, ParamValue>;
  subAbility?: EffectInvocation;           // chained SubAbility$
}
```

### AbilityAst

```ts
type AbilityAst =
  | { kind: "spell"; effect: EffectInvocation; cost: CostAst; rules: string; ... }
  | { kind: "activated"; effect: EffectInvocation; cost: CostAst; timing: Timing; rules: string; ... };
```

Similar typed shapes for `TriggerAst`, `ReplacementAst`, `StaticAst`, `KeywordAst`, `SVarAst`, `CostAst`.

## 4. 204 SpellAbilityEffect handlers

One class per handler, flat directory `@mtg-forge-ts/game/src/ability/effects/`.

### Base class

```ts
abstract class SpellAbilityEffect {
  static readonly handlerKey: string;

  // Resolve this ability on the stack. Generator yields decisions/events.
  abstract *resolve(sa: SpellAbility, game: Game): Generator<EngineYield, void, DecisionResponse>;

  // Optional: the rules-text description shown in UI. Defaults to SpellDescription$ param.
  getStackDescription?(sa: SpellAbility): string;
}
```

### Registration

```ts
// In XEffect.ts, at module scope:
EffectRegistry.register(XEffect);
```

### Example structure

```ts
class DrawEffect extends SpellAbilityEffect {
  static readonly handlerKey = "Draw";

  *resolve(sa: SpellAbility, game: Game): Generator<EngineYield, void, DecisionResponse> {
    const count = evaluateSVar(sa.params.get("NumCards") ?? { kind: "literal", raw: "1" }, sa, game);
    const targetPlayers = sa.targets.getPlayers(game);
    for (const player of targetPlayers) {
      yield* game.action.drawCards(player.seat, count, { source: sa.sourceId });
    }
    if (sa.subAbility) yield* sa.subAbility.resolve(game);
  }
}

EffectRegistry.register(DrawEffect);
```

### Category counts (flat directory; categorization is comments only)

Approximate distribution for scope planning:

| Category | Count |
|---|---:|
| Damage & life | ~18 |
| Card movement (draw/discard/mill/exile/return/move) | ~32 |
| Tokens & emblems | ~12 |
| Mana | ~9 |
| Counters (add/remove/move/multiply/proliferate) | ~11 |
| Targeting-aware (destroy, choose, wish) | ~18 |
| Combat modifiers (pump, fight, attach) | ~14 |
| Conditional/branching (if-else, repeat, forEach) | ~11 |
| Board-wide (wrath-style) | ~9 |
| Control & ownership | ~6 |
| Game flow (extra turn, extra phase) | ~9 |
| Dice/coin/random | ~4 |
| Library manipulation (scry, surveil, dredge, tutor) | ~8 |
| Copy mechanics | ~7 |
| Modal (ChooseMode, MultiMode, Convoke, Improvise) | ~6 |
| Commander / multiplayer (vote, monarch, initiative) | ~5 |
| Un-set specific | ~8 |
| Misc (phasing, animate, grant ability) | ~17 |

Exact totals match Forge's current count after first sync.

## 5. 139 TriggerHandler classes

Flat directory `@mtg-forge-ts/game/src/trigger/handlers/`.

### Base class

```ts
abstract class TriggerHandler {
  static readonly handlerKey: string;

  // Does this event match this trigger's conditions?
  abstract matchesEvent(event: GameEvent, trigger: TriggeredAbility, game: Game): boolean;

  // Build the resulting SpellAbility when this trigger fires.
  abstract buildTriggeredAbility(trigger: TriggeredAbility, event: GameEvent, game: Game): SpellAbility;
}
```

### Category distribution

| Category | Count |
|---|---:|
| Zone changes | ~18 |
| Combat events | ~22 |
| Phase/step | ~14 |
| Player events | ~14 |
| Spell & ability | ~12 |
| Counter & damage | ~10 |
| Stateful / conditional | ~12 |
| Tap/untap/flip | ~6 |
| Modern keywords | ~10 |
| Miscellaneous | ~21 |

## 6. 46 ReplacementHandler classes

Flat directory `@mtg-forge-ts/game/src/replacement/handlers/`.

### Base class

```ts
abstract class ReplacementHandler {
  static readonly handlerKey: string;

  abstract appliesTo(intent: MutationIntent, replacement: ReplacementEffect, game: Game): boolean;

  // Return modified intent (maybe identical), or null to prevent entirely.
  abstract apply(intent: MutationIntent, replacement: ReplacementEffect, game: Game): MutationIntent | null;
}
```

### Categories

| Category | Count |
|---|---:|
| Damage replacement | ~9 |
| Zone-change replacement | ~14 |
| Draw replacement | ~4 |
| Counter replacement | ~3 |
| Life replacement | ~3 |
| Turn structure replacement | ~4 |
| Mana / cost replacement | ~3 |
| Misc | ~6 |

## 7. 34 KeywordHandler classes

Flat directory `@mtg-forge-ts/game/src/keyword/handlers/`.

### Seven shapes

Keywords take one of seven shapes (classifying Forge's 34 handler classes, which cover ~170 MTG keywords via parameterization):

1. **Flag keyword** — sets a static flag on the card (Flying, Reach, Trample, Deathtouch, Lifelink, Vigilance, Haste, Indestructible, Hexproof, Shroud, Menace, Defender, Fear, Intimidate).
2. **Static-restriction keyword** — adds a combat/targeting restriction (Skulk, Shadow, Protection, Horsemanship, Islandwalk).
3. **Static-continuous keyword** — contributes a continuous effect (Exalted, Battle Cry, Rampage N, Flanking).
4. **Triggered keyword** — generates a triggered ability (Annihilator, Cascade, Storm, Prowess, Living Weapon, Soulbond, Outlast, Dethrone).
5. **Activated keyword** — generates an activated ability (Cycling, Morph, Unearth, Scavenge, Embalm, Eternalize, Channel, Transmute, Ninjutsu, Flashback [cast], Disturb [cast]).
6. **Replacement-generating keyword** — adds a replacement effect (Absorb, Amplify, Buyback [replace discard-from-hand? etc., contextual], Fading, Vanishing).
7. **Alt/additional cost keyword** — registers with AltCostRegistry (Flashback, Madness, Foretell, Disturb, Escape, Bestow, Jump-Start, Aftermath, Overload, Cleave, Buyback, Kicker/Multikicker, Entwine, Escalate, Replicate, Conspire, Retrace, Prowl, Evoke, Commander ninjutsu).

Some keywords belong to multiple shapes (Flashback has both #5 activated-ability shape AND #7 alt-cost shape).

## 8. SVar resolution

### Grammar

```
SVar  := Count$<selector>
      |  Number$<integer>
      |  PlayerCount$<selector>
      |  SumPower$<selector> | SumToughness$<selector> | SumCMC$<selector>
      |  Targeted$<index>
      |  DB$<handlerKey>(params)        // ability SVar — evaluates to a sub-ability
      |  <arithmetic>                    // + - * / min max
      |  LifeTotal$<playerSelector>
      |  XChoice                         // the X value chosen for this spell
      |  ...
```

~100 selector kinds in Forge; we port each as a small evaluator class.

### Evaluator

```ts
// Lives in @mtg-forge-ts/game/src/svar/
function evaluateSVar(pv: ParamValue, sa: SpellAbility, game: Game): number | SpellAbility {
  switch (pv.kind) {
    case "literal": return parseLiteralValue(pv.raw);
    case "svarRef": return evaluateSVar(sa.sourceCard.definition.svars.get(pv.name)!, sa, game);
    case "expression": return evaluateExpression(pv.ast, sa, game);
  }
}

function evaluateExpression(ast: SVarExpressionAst, sa, game): number | SpellAbility {
  // Dispatch on ast.kind to the registered SVar evaluator class
}
```

### Static validation

Structural validator (SP3) checks every SVar reference resolves. Semantic validator checks each selector kind is registered with a known evaluator.

## 9. CostPart handlers (~30)

Lives in `@mtg-forge-ts/game/src/cost/`. Each class:

```ts
abstract class CostPart {
  static readonly handlerKey: string;

  abstract canPay(ctx: CostPaymentContext): boolean;
  abstract *pay(ctx: CostPaymentContext): Generator<EngineYield, void, DecisionResponse>;
  abstract undo(ctx: CostPaymentContext): void;          // distributed undo for cast-abort rollback
}
```

Classes: CostMana, CostTap, CostUntap, CostSacrifice, CostDiscard, CostExile, CostPayLife, CostPayEnergy, CostPayExperience, CostRemoveCounter, CostPutCounter, CostReveal, CostMill, CostReturn, CostUnattach, CostGainControl, CostFlipCoin, CostRollDie, CostSkipTurn, CostPayTicket, CostPayRad, etc. (~30 total).

### Mana cost solver (specialized — in `@mtg-forge-ts/game/src/mana/ManaCostSolver.ts`)

Constraint satisfaction for hybrid/phyrexian/generic/X/snow costs. Produces a payment plan or `null` if unable to pay.

## 10. Alternative / additional cost registry (`AltCostRegistry`)

Lives in `@mtg-forge-ts/game/src/altcost/`. Entries:
- Flashback, Madness, Foretell, Disturb, Escape, Bestow, Jump-Start, Aftermath, Overload, Cleave, Buyback, Kicker, Multikicker, Entwine, Escalate, Replicate, Conspire, Retrace, Prowl, Evoke, Plot, etc.

Each registers hooks:
- `isAvailable(card, game, zone)` — can this alt cost be used right now?
- `modifyCastContext(ctx, chosen)` — how does choosing this alt-cost change the cast (alternate mana cost, additional cost appended, post-resolution zone override, etc.).
- `tagStackItem(stackItem, ctx)` — writes provenance fields.

Cast pipeline step 4 iterates registry, yields `chooseAltCost` decision with available options, applies chosen.

## 11. Cross-card references

### Token templates

Forge vendors predefined tokens as card-like scripts. `TokenDb` (in `@mtg-forge-ts/cards`) indexes by canonical name ("Soldier 1/1 W", "Treasure", "Food", etc.).

`TokenEffect.resolve()` either:
- Looks up template by name from `TokenDb` (predefined), or
- Parses inline token definition from the creating card's script.

### Named card references

Cards referencing other specific cards by name (rare — e.g., "Create a token that's a copy of [specific card]"). Resolved at runtime via `cardDb.getDefinition(name)`.

### Linked abilities (CR 607)

Per-instance linkage between abilities on the same card. Stored on the ability instance, not the card definition.

## 12. Factory dispatch — from AST to live ability

When a card enters a zone and its abilities become active:

```ts
class Card {
  activateAbilitiesFromDefinition(): void {
    for (const abilityAst of this.definition.abilities) {
      const HandlerClass = EffectRegistry.lookup(abilityAst.effect.handlerKey);
      const ability = new HandlerClass(abilityAst, this);
      this.registerAbility(ability);
    }
    // ... same for triggers, replacements, statics, keywords
  }
}
```

Each registry is a `Map<string, HandlerClass>` populated at module load via `register()` calls.

Adding a new handler: write class + `Registry.register(NewHandler)`. No wiring elsewhere. No switch statements.

## 13. Validator as sync gate

Per the C-9 upstream sync flow:
- `sync-card-data.ts` pulls upstream.
- Runs **structural validator** over all changed files.
- Runs **semantic validator** via `tools/dsl-validator/`.
- If any file references an unknown handler key or unknown selector → PR is blocked.
- Human ports the missing handler, unblocks, merges.

Card database never references a handler that doesn't exist.

## 14. Testing strategy

- **Unit** per handler class — minimal synthetic state, assert behavior.
- **Fixture** per handler — 3-5 real-card scenarios exercising the handler.
- **Parser round-trip** — every vendored `.txt` file parses; `parse(file) → serialize → parse` is stable.
- **SVar evaluator unit tests** — each selector kind exercised.
- **Golden-master** — flagship cards (Lightning Bolt, Wrath of God, Cryptic Command, Birthing Pod, Goblin Lackey, Commander tutors) run end-to-end and diff against Forge.

Handler fixture file template:

```ts
// packages/game/src/ability/effects/__fixtures__/DrawEffect.fixture.ts
describe("DrawEffect", () => {
  it("draws the target number of cards", async () => {
    const game = await buildFixtureGame({
      player0Deck: "mono-u-draw-testing",
      startingHandSize: 0,
    });
    await game.action.castSpell("Divination", { controller: 0 });
    expect(game.getPlayer(0).hand.length).toBe(2);
  });
  // ... 2-4 more scenarios
});
```

## 15. Phases (solo, sequential)

| Phase | Scope |
|---|---|
| **3a** | DSL parser: lexer + line parsers + AST assembler |
| **3b** | Structural validator |
| **3c** | SVar evaluator + initial selector set (Count$, Number$, PlayerCount$, SumPower$, arithmetic) |
| **3d** | Additional SVar selectors (long tail) |
| **3e** | CostPart hierarchy (30 classes) |
| **3f** | AltCostRegistry + mainstream alt-costs (Flashback, Madness, Foretell, Bestow, Overload) |
| **3g** | Remaining alt-costs (Jump-Start, Escape, Disturb, Cleave, Buyback, etc.) |
| **3h** | First 30 most-common effect handlers (Draw, DealDamage, Destroy, Pump, Counter, Search, Mill, Discard, Exile, ReturnToHand, AddCounter, etc.) + fixtures |
| **3i** | Effect handlers: damage/life/counters category |
| **3j** | Effect handlers: card movement category |
| **3k** | Effect handlers: tokens/emblems + TokenFactory integration |
| **3l** | Effect handlers: mana category |
| **3m** | Effect handlers: combat modifiers category |
| **3n** | Effect handlers: targeting-aware (destroy variants, choose variants) |
| **3o** | Effect handlers: conditional/branching |
| **3p** | Effect handlers: board-wide |
| **3q** | Effect handlers: control/ownership/game-flow |
| **3r** | Effect handlers: dice/coin/RNG |
| **3s** | Effect handlers: library manipulation |
| **3t** | Effect handlers: copy mechanics |
| **3u** | Effect handlers: modal |
| **3v** | Effect handlers: commander/multiplayer |
| **3w** | Effect handlers: miscellaneous + Un-set |
| **3x** | Trigger handlers (139 classes, grouped by category) |
| **3y** | Replacement handlers (46 classes, grouped by category) |
| **3z** | Keyword handlers (34 classes, 7 shapes) |
| **3aa** | Semantic validator in `tools/dsl-validator/` |
| **3ab** | Handler fixture suite (3-5 fixtures per handler, many shared scenario utilities) |
| **3ac** | Integration test: flagship card end-to-end |

With ~423 handlers + 30 cost parts, SP3 is the longest workstream. Prioritization: 3a-g foundations first, then 3h (top 30 effects) to unblock end-to-end games early. Remaining handlers fill out incrementally.

## 16. What SP3 does NOT cover

- Ingesting the full 32k card database — SP4.
- Token template registry (lives in cards) — SP4.
- AI logic for each effect (the `XEffectAi` classes) — SP5.
- Format / legality — SP6.
- Limited-specific card interactions (draft-matters) — SP7.
