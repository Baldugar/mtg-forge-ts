# SP1 — Engine Foundations

**Status:** Design approved
**Date:** 2026-04-23
**Packages:** `@mtg-forge-ts/core` (full), `@mtg-forge-ts/game` (scaffold)
**Prerequisites:** None (foundational)

---

## Purpose

Establish the skeleton every other sub-project builds on: the fundamental types, the mutation model, the decision interface, the serialization contract, the phase/step machine, the stack, zones, mana, cost, and the match+game lifecycle. After SP1 completes, a scripted "do nothing" game can run end-to-end with placeholder rules systems; SP2 fills in the actual rules logic.

## 1. Package responsibilities

### `@mtg-forge-ts/core` — data types + shared contracts

Pure data, zero runtime dependencies. Types imported by every other package.

- **Identity types** — `EntityId` (branded `number`), `DecisionId` (branded `number`), `PlayerSeat` (`number` 0…N-1), `LobbyPlayer` (pre-game identity).
- **Card data types** — `PaperCard` (a printing), `CardDefinition` (parsed rules), `CardType` (supertypes/types/subtypes), `ColorSet` (5-color bitset).
- **Mana types** — `ManaCost` (immutable), `ManaSymbol` (colored/hybrid/phyrexian/variable/generic/snow/colorless), `ManaValue` (numeric CMC), `ManaShard` (individual piece of mana with source metadata).
- **Cost types** — `Cost` (list of `CostPart`), `CostPart` subclasses: CostMana, CostTap, CostUntap, CostSacrifice, CostDiscard, CostPayLife, CostExile, CostReveal, CostRemoveCounter, CostPutCounter, CostPayEnergy, CostPayExperience, CostMill, CostReturn, CostUnattach, CostFlipCoin, CostRollDie, and ~15 more (full taxonomy from Forge).
- **Deck types** — `Deck` (main + sideboard + commander + planar + scheme + conspiracy + attractions + contraptions), `DeckFormat` (validation rules per format).
- **Zone enum** — `ZoneType`: Library, Hand, Battlefield, Graveyard, Exile, Stack, Command, Ante, Sideboard, PlanarDeck, SchemeDeck, ConspiracyDeck, AttractionDeck, ContraptionDeck, StickerDeck, Banished, Phased, None, OutsideGame.
- **Image identifiers** — `ImageKeys` constants + Scryfall URL builders (ported from Forge's `ImageKeys` and `ImageUtil`).
- **DSL AST types** — typed shape of parsed card script data: `SpellAbilityScript`, `TriggeredAbilityScript`, `ReplacementScript`, `StaticAbilityScript`, `KeywordScript`, `ManaAbilityScript`, `CostScript`, `SVarExpressionAst`, `ParamValue` discriminated union (`{kind: "literal" | "svarRef" | "expression", ...}`).
- **Deterministic primitives** — `Rng` interface (`nextInt`, `nextFloat`, `shuffle`, `choose`, `nextLong`, `getState`, `setState`), `SeededRng` default impl using xoshiro256**.
- **View types** — `GameView`, `PlayerView`, `CardView`, `ZoneView`, `StackItemView`, `CombatView`. Consumer-facing read-only projections with hidden-information filtering.
- **Event types** — `GameEvent` discriminated union. Every event has `{kind: string, version: number, payload: ...}` shape. See §8 for enumeration.
- **Decision types** — `DecisionRequest` + `DecisionResponse` discriminated unions for all 22 `PlayerController` kinds, 3 `MatchController` kinds, and (via cross-reference) `DraftPlayerController` kinds. See §7.
- **Format types** — `FormatDefinition` interface (schema only; concrete definitions live in `@mtg-forge-ts/formats`).
- **Error types** — typed error hierarchy (see §12).
- **Counter types** — `CounterType` enum (~60 values: +1/+1, -1/-1, Loyalty, Defense, Charge, Age, Level, Time, Lore, Stun, Shield, Quest, Poison, Energy, Experience, Ticket, Rad, Verse, Divinity, Wish, Feather, Wind, Training, Velocity, Fate, Ice, Petal, Pupa, Flame, Bore, Blaze, Brick, Bribery, Corpse, Credit, Crystal, Delay, Despair, Depletion, Dread, Echo, Egg, Everything, Eyeball, Fade, Filibuster, Flood, Fungus, Fuse, Gem, Gold, Growth, Hatchling, Hit, Hoofprint, Hour, Hourglass, Hunger, Husk, Incubation, Infection, Influence, Intervention, Isolation, Javelin, Judgment, Ki, Knowledge, Landmark, Lotus, Loyalty-like, Luck, Manabond, Manifestation, Mannequin, Matrix, Mine, Mining, Mire, Music, Muster, Net, Omen, Ore, Page, Pain, Paralyzation, Phylactery, Pin, Plague, Plot, Point, Polyp, Pressure, Prey, Pupa, Quest, Rejection, Reprieve, Rev, Revival, Rope, Rust, Scream, Scroll, Shell, Silver, Sleep, Sleight, Slime, Slumber, Soot, Spite, Spore, Sprout, Storage, Strife, Tide, Tower, Training, Trap, Treasure, Unity, Velocity, Volatile, Winch, Wind, Wish, etc. — full list ported from Forge's CounterEnumType).
- **Log types** — `GameLog`, `GameLogEntry`, `GameLogVerbosity`.

### `@mtg-forge-ts/game` (scaffold) — engine skeleton

Implementation in SP2-SP7 fills it in; SP1 scaffolds:

- `Game` — top-level live game.
- `Match` + `MatchController` — best-of-N lifecycle.
- `Player` — live in-game player (distinct from `LobbyPlayer`).
- `Card` — live in-game card (distinct from `PaperCard`/`CardDefinition`).
- `Zone` (+ subclasses for specific zones: `Library`, `Hand`, `Graveyard`, `Battlefield`, `ExileZone`, `CommandZone`, etc.).
- `GameAction` — the main mutator.
- `GameRules` — per-game config.
- `PhaseHandler` — phase/step machine.
- `ManaPool` — per-player mana.
- `CombatHandler` + `CombatState` — scaffolded; full logic in SP2.
- `Stack` — MTG stack.
- `TargetSystem` — targeting primitives.
- `PlayerController` interface.
- `MatchController` interface.
- `DecisionLog`.
- Registry scaffolds: `TriggerRegistry`, `ReplacementRegistry`, `StaticEffectRegistry` (implementations in SP2).

## 2. State model

`Game` is a tree of serializable plain-data state plus registries.

```
Game
├── meta: GameMeta                         # {engineVersion, forgeSha, cardDataSyncedAt, crVersion, seed}
├── rules: GameRules                       # frozen per game (format, mulligan rule, player count, rule overrides)
├── rng: Rng                               # mutable state
├── entityIdCounter: number                # monotonic
├── turn: number                           # absolute turn counter
├── phase: PhaseStep
├── activePlayer: PlayerSeat
├── priorityPlayer: PlayerSeat | null
├── players: Player[]                      # N players
│   └── Player
│       ├── seat, team, life, counters (poison/energy/experience/rad/ticket/speed/...)
│       ├── manaPool: ManaPool
│       ├── battlefield: Battlefield (per-player)
│       ├── library, hand, graveyard, sideboard, commandZone, planarDeck, schemeDeck, conspiracyDeck, attractionDeck, contraptionDeck, stickerDeck
│       └── outsideGame: PaperCard[]       # wish pool
├── sharedZones: { stack, exile, ante }
├── stack: StackState
├── combat: CombatState | null
├── continuousEffects: ContinuousEffect[]  # sorted by timestamp asc
├── pendingTriggers: DelayedTrigger[]
├── replacementRegistry: ReplacementEffect[]
├── triggerRegistry: TriggeredAbility[]
├── staticRegistry: StaticAbility[]
├── decisionLog: DecisionLog
├── log: GameLog
├── flags: GameFlags                       # see §5
├── match: Match | null                    # back-reference if in a match
├── formatSnapshot: FormatDefinitionSnapshot  # frozen at game start
└── terminalState: TerminalState | null    # set when game ends
```

Every entity (Card, Player, StackItem, Token, Emblem, DelayedTrigger) carries a stable `EntityId` drawn from `entityIdCounter`. References use IDs; live objects resolve via `game.getCard(id)` etc.

## 3. Mutation model

Three mutators, each with a clear domain:

- **`GameAction`** — card/player/zone/counter/life/mana/stack state. Every mutation is a method: `moveTo`, `damage`, `drawCards`, `discard`, `sacrifice`, `changeLife`, `tap`, `untap`, `addCounter`, `removeCounter`, `changeControl`, `exile`, `destroy`, `putOnStack`, `resolveStack`, `createToken`, `createEmblem`, `mill`, `scry`, `surveil`, `proliferate`, etc. Each:
  1. Constructs a typed `MutationIntent`.
  2. Runs replacement effects (see SP2).
  3. Applies the resulting intent's state delta.
  4. Emits events (yielded through the unified stream).
  5. Collects pending triggers.

- **`CombatHandler`** — mutates `CombatState`. Methods: `declareAttackers`, `declareBlockers`, `assignDamageOrder`, `applyCombatDamage`, `endCombat`, plus mid-combat primitives for Ninjutsu (swap attacker), bands, etc.

- **Subsystem internals** — registries, caches. Only modified by their owning subsystem. Never by external code.

All mutation paths are **generator functions**. Callers chain with `yield*`. Yields are of shape `{kind: "decision", request: ...}` or `{kind: "event", event: ...}`.

## 4. Generator-based engine and controller model

### Core loop shape

```ts
function* runGame(game: Game): Generator<EngineYield, TerminalState, DecisionResponse> {
  yield* game.setup();                    // §6 Game setup
  while (!game.isTerminal()) {
    yield* game.phaseHandler.runPhase();
  }
  return game.terminalState;
}
```

### Yields

Engine yields a discriminated union:

```ts
type EngineYield =
  | { kind: "decision", request: DecisionRequest }
  | { kind: "event", event: GameEvent };
```

Driver iterates:

```ts
const gen = game.run();
let step = gen.next();
while (!step.done) {
  if (step.value.kind === "decision") {
    const response = controller.decide(step.value.request);  // sync, Promise, or scripted
    step = gen.next(response);
  } else {
    eventSubscribers.forEach(s => s.onEvent(step.value.event));
    step = gen.next();
  }
}
```

Events are buffered at the operation boundary. On cast-abort, buffered events since the cast-begin boundary are discarded; a `CastAborted` event is emitted in their place. Event subscribers never see partial-state from aborted operations.

### Controller interfaces

**`PlayerController`** (22 decision kinds, per-game, per-seat):

```ts
interface PlayerController {
  decide(request: DecisionRequest): DecisionResponse;
}

type DecisionRequest =
  | { kind: "mulligan", playerSeat, currentHand, mulligansSoFar, rule }
  | { kind: "openingHandAction", playerSeat, availableActions }
  | { kind: "priority", playerSeat, legalActions }
  | { kind: "chooseTargets", sourceId, restriction, min, max, choicesAllowed }
  | { kind: "chooseModes", sourceId, modes, min, max }
  | { kind: "chooseX", sourceId, maxX }
  | { kind: "distribute", sourceId, amount, recipients, minPerRecipient }
  | { kind: "choosePayment", cost, payableSources }
  | { kind: "orderTriggers", playerSeat, triggerIds }
  | { kind: "orderReplacements", playerSeat, replacementIds }
  | { kind: "declareAttackers", playerSeat, legalAttackers, legalDefenders }
  | { kind: "declareBlockers", playerSeat, legalBlockers, attackers }
  | { kind: "orderBlockers", playerSeat, attackerId, blockers }
  | { kind: "assignDamage", attackerId, blockerOrder, amountToAssign }
  | { kind: "chooseCard", playerSeat, pool, restriction, min, max }
  | { kind: "chooseCardOrder", playerSeat, cards }
  | { kind: "scry", playerSeat, cards }
  | { kind: "surveil", playerSeat, cards }
  | { kind: "chooseOption", sourceId, options }
  | { kind: "declareSplit", sourceId, faces }
  | { kind: "choosePlayer", sourceId, restriction, min, max }
  | { kind: "chooseZone", sourceId, zones }
  | { kind: "chooseAltCost", sourceId, altCosts };
```

**`MatchController`** (3 decision kinds, per-match, per-seat):

```ts
interface MatchController {
  decide(request: MatchDecisionRequest): MatchDecisionResponse;
}

type MatchDecisionRequest =
  | { kind: "sideboard", playerSeat, mainDeck, sideboard, format }
  | { kind: "concedeMatch", playerSeat }
  | { kind: "acceptDrawOffer", playerSeat, offeredBy };
```

Consumer apps can implement both with one class if desired.

### Controller implementations (library-provided)

- `HumanController` (per-game) — delegates to a consumer callback. Consumer supplies `async (req) => DecisionResponse` and the library adapts to sync-over-async via the suspendable engine pattern.
- `RandomLegalController` — picks uniformly from legal options. Used for golden-master tests that don't care about AI quality.
- `ScriptedController` — reads decisions from a pre-recorded log. Used in replay and golden-master.
- `FullForgeAiController` — provided by `@mtg-forge-ts/ai` (SP5).

## 5. Game flags

State-level flags that aren't zone/card/player counter specific:

```ts
interface GameFlags {
  dayNight: "day" | "night" | "neither";
  monarch: PlayerSeat | null;
  initiative: PlayerSeat | null;
  cityBlessing: Set<PlayerSeat>;              // sticky once earned
  ringBearer: Map<PlayerSeat, EntityId | null>;
  ringLevel: Map<PlayerSeat, 0 | 1 | 2 | 3 | 4>;
  speedLevel: Map<PlayerSeat, 0 | 1 | 2 | 3 | 4>;
  currentDungeon: Map<PlayerSeat, { card: EntityId, position: string } | null>;
  commandersOwnedByPlayer: Map<PlayerSeat, EntityId[]>;
  commanderCastCount: Map<EntityId, number>;  // for commander tax
  commanderDamage: Map<EntityId, Map<PlayerSeat, number>>;  // (dealer, target) → damage
  firstTurnDrawSkipped: Map<PlayerSeat, boolean>;
  mulligansTaken: Map<PlayerSeat, number>;
  landsPlayedThisTurn: Map<PlayerSeat, number>;
  spellsCastThisTurn: Map<PlayerSeat, number>;
  turnsTakenThisTurn: number;
  skippedPhases: PhaseStep[];
  activeTeamForTeamPlay: number | null;
  seatEliminated: Map<PlayerSeat, boolean>;
  stickers: StickerSheet[];
  attractions: Map<PlayerSeat, AttractionState>;
}
```

All serializable. Updated only via `GameAction` (or `GameSetup` for initial values).

## 6. Game setup flow

`Game.setup()` is a generator that runs these steps in order:

1. **Validate inputs** — decks legal, seats unique, format known.
2. **Apply format rules** — `game.applyFormatRules(formatId)` sets starting life, hand size, mulligan rule, first-player-draw-skip policy, active rule overrides.
3. **Assign teams** (if team play) — per `GameRules.teamAssignments`.
4. **Assign commanders** (if Commander-family format) — parse `deck.commanderSlot`.
5. **Shuffle libraries** — each player's library shuffled using `game.rng`.
6. **Move commanders to command zone** (if applicable).
7. **Leyline / Gemstone-Caverns-type opening reveal** — yield `openingHandAction` decisions to players.
8. **Draw opening hands** — each player draws to starting hand size.
9. **Mulligan rounds** — per `GameRules.mulliganRule`:
   - London: mulligan → redraw full; bottom N cards where N = mulligans taken.
   - Vancouver: mulligan → redraw size-1.
   - Paris: same but with scry before first draw.
   - Free: first mulligan doesn't count.
   Each round yields `mulligan` decisions per player.
10. **Final opening actions** — companion declaration, Serum Powder repeated mulligan, etc.
11. **Choose starter** — if match context provides, use it; else die roll via `game.rng`.
12. **Initialize turn structure** — `game.turn = 1`, active player = starter.
13. **Emit `GameStarted` event.**
14. **Enter first turn.**

## 7. Phase/step machine

`PhaseHandler` runs the canonical phase sequence per turn, with extra/skip/priority pumping.

### Phase enum (CR 500-514 canonical)

```ts
enum PhaseStep {
  Untap,
  Upkeep,
  Draw,
  PreCombatMain,
  BeginCombat,
  DeclareAttackers,
  DeclareBlockers,
  FirstStrikeDamage,
  CombatDamage,
  EndOfCombat,
  PostCombatMain,
  EndStep,
  Cleanup
}
```

### Turn queue + phase sequence

```ts
class TurnQueue {
  private turns: Turn[];
  push(turn: Turn): void;
  pop(): Turn;
  injectSkip(count: number): void;
  peekNext(): Turn | null;
}

class PhaseSequence {
  private steps: PhaseStep[];
  injectExtraCombat(): void;     // inserts BeginCombat...EndOfCombat after current combat
  skipStep(step: PhaseStep): void;
  isSkipped(step: PhaseStep): boolean;
}
```

Extra turns push onto the queue; skipped turns pop without running. Extra phases insert into the current turn's sequence; skipped phases flag-out.

### Turn-based actions vs triggered abilities

- **Turn-based actions** (CR 703): rule-mandated, automatic. Run by `PhaseHandler.performTurnBasedActions(step, activePlayer)`:
  - Untap step: untap active player's permanents (respecting "don't untap" effects).
  - Draw step: active player draws (skipped first turn if 2-player + `firstPlayerSkipsDraw`).
  - Begin combat: set combat state.
  - Declare attackers: yield `declareAttackers` decision.
  - Declare blockers: yield `declareBlockers` decision, then `orderBlockers` if needed.
  - Combat damage: assign + deal damage.
  - End of combat: clear combat state.
  - Cleanup: discard to hand size, damage wears off, "until end of turn" effects expire. Loop if SBAs fire.
  - Between steps: empty mana pools, check SBAs, put triggered abilities on stack.

- **Triggered abilities at phase boundaries** (`"at the beginning of X"`): not turn-based actions. Fire via `TriggerRegistry` reacting to `PhaseChanged` events.

### Priority pump

After every state change, the orchestrator runs:

```
loop {
  did_something = false;
  if (sbaEngine.sweep()) did_something = true;
  if (triggerRegistry.drainToStack()) did_something = true;
  if (!did_something) break;
}
yield_priority_to_active_player();
```

Details in SP2 (rules systems). Here in SP1: scaffolded as a loop that calls into subsystem stubs.

## 8. Event taxonomy

~60 `GameEvent` discriminated-union variants. Every event has `{kind: string, version: number, turn: number, phase: PhaseStep, payload: ...}`. Full enumeration in SP2 spec appendix. Event families:

| Family | Approx count | Examples |
|---|---:|---|
| Zone change | 10 | CardDrawn, CardDiscarded, CardMilled, CardDestroyed, CardExiled, CardSacrificed, CardReturned, CardCycled, CardForetold, CardChangedZone (generic) |
| State change | 12 | LifeChanged, CounterAdded, CounterRemoved, CardTapped, CardUntapped, ControlChanged, AttachmentChanged, PhasedOut, PhasedIn, Flipped, Transformed, FaceDownStateChanged |
| Monarch/Initiative/Ring | 5 | BecameMonarch, LostMonarch, BecameInitiative, RingTempted, RingLevelChanged |
| Stack | 8 | SpellCast, SpellPutOnStack, AbilityActivated, AbilityTriggered, StackItemResolving, StackItemResolved, StackItemCountered, StackItemCopied |
| Combat | 10 | CombatStarted, AttackersDeclared, BlockersDeclared, BlockerOrderSet, DamageAssigned, DamageDealt, DamagePrevented, AttackerBecomesBlocked, CombatEnded, CombatCreatureDied |
| Phase | 5 | TurnStarted, TurnEnded, PhaseStarted, StepStarted, StepEnded |
| Player | 8 | PlayerLifeChanged (alias), PlayerDrew, PlayerDiscarded, PlayerMilled, PlayerLost, PlayerWon, PlayerConceded, CityBlessingGained |
| Meta | 5 | GameStarted, MulliganTaken, GameEnded, CastAborted, ShortcutApplied |

Each event is versioned. Breaking changes to an event's payload bump `version` and (per §11) major semver.

## 9. Mana pool + stack + targeting

### ManaPool

`ManaPool` holds `ManaShard[]` per player. Each shard: color, source, restrictions.

Operations: `add(shard)`, `remove(color, amount, restriction)`, `empty()` (called at step/phase boundaries per CR 106.4), `canPay(cost)`, `takeSnapshot()`, `restoreSnapshot()`.

### Stack

`Stack` holds ordered `StackItem[]`. StackItem has:
- `id: EntityId`
- `sourceCardId: EntityId`
- `controllerSeat: PlayerSeat`
- `kind: "spell" | "activatedAbility" | "triggeredAbility" | "copy"`
- `targets: TargetChoices`
- `modes: Mode[]`
- `xValue: number | null`
- `costPaid: PaidCost`
- `provenance: StackItemProvenance`  // {originZone, altCostUsed, additionalCostsPaid, cascadeOrigin?, copiedFrom?}

Operations: `push`, `pop`, `peek`, `resolve` (uses top StackItem's handler), `countItemsBySource(cardId)`.

### Targeting

`TargetSystem` covers:
- `TargetRestriction` (card types, players, count bounds, predicates).
- `TargetChoices` (what was actually targeted — by EntityId).
- Target legality check (at cast and at resolution — CR 608.2b).
- Target swap effects (Misdirection class).

Details of target legality rules (illegal-on-resolve = ability fizzles if all illegal; partial-fizzles if some illegal) fleshed out in SP2.

## 10. Cost paying

`Cost` is a list of `CostPart`. Paying a cost is a generator:

```ts
function* payCost(cost: Cost, ctx: CostPaymentContext): Generator<DecisionRequest, boolean, DecisionResponse> {
  // 1. Can-pay check
  if (!canPay(cost, ctx)) return false;
  // 2. Yield choosePayment decision; receive plan
  const plan = yield { kind: "choosePayment", cost, payableSources: enumerate(cost, ctx) };
  // 3. Apply each CostPart's pay method (each is a generator)
  for (const part of cost.parts) {
    yield* part.pay(plan, ctx);
  }
  return true;
}
```

Each `CostPart` has:
- `canPay(ctx): boolean` — cheap satisfiability check.
- `pay(plan, ctx): Generator<...>` — actual payment; may yield for sub-decisions.
- `undo(ctx)` — reverses the payment (distributed undo for cast-abort rollback).

Cost modifier order (CR 601.2f-g, strict):
1. Alternative costs applied (replaces base cost).
2. Additional costs applied (appended).
3. Cost increases applied.
4. Cost reductions applied.
5. Minimum floor: {0} per color, {0} generic.

## 11. Zones and zone changes

Every `Card` has exactly one zone at any time. Zone changes via `GameAction.moveTo(cardId, toZone, opts)`:

1. Build `ZoneChangeIntent {cardId, fromZone, toZone, cause}`.
2. Run replacements.
3. Remove from source zone at known index.
4. Add to destination zone at specified index or end.
5. Reset card state per CR 613.2 (enters with counters zeroed unless replacement specifies, damage wears, non-keyword abilities reset, etc.).
6. Emit `CardChangedZone` event.
7. Queue ETB/LTB triggers.

Per-player zones: Library, Hand, Graveyard, Sideboard, PlanarDeck, SchemeDeck, ConspiracyDeck, AttractionDeck, ContraptionDeck, StickerDeck.
Shared zones (owned by `Game`): Stack, Exile, Ante.
Battlefield: per-player (each player's battlefield contains permanents they control; control-change moves the card between battlefields).
Special state on `Card`: phased, face-down (with face-down sub-state discriminator).

Zone contents are ordered (library, graveyard, exile, hand, battlefield — order matters for various effects).

### Owner vs controller

- `Card.ownerSeat` — frozen at game start (except for certain Un-set effects).
- `Card.controllerSeat` — mutable; controller-change moves card between battlefields.
- Zone-change to non-battlefield sends card to **owner's** zone, regardless of current controller.
- Control reverts at end of temporary control effect; card moves back.

## 12. Serialization contract

Every class appearing in stored state implements:

```ts
interface Snapshotable<Snap> {
  toJSON(): Snap;                          // plain data, JSON-safe
}
static fromJSON(snap: Snap, ctx: RestoreContext): Self;
```

Polymorphic types include `kind: "..."` discriminator. `fromJSON` dispatches.

`Game.snapshot()` produces `GameSnapshot`. `Game.restore(snap, controllers)` rebuilds; controllers re-bound at restore.

### GameSnapshot header (top-level metadata)

```ts
interface GameSnapshotHeader {
  schemaVersion: number;
  engineVersion: string;
  forgeSha: string;
  cardDataSyncedAt: string;
  crVersion: string;
  savedAt: string;
  formatId: string;
  formatDefinitionSnapshot: FormatDefinitionSnapshot;  // full format definition at game start
  seed: string;  // bigint as hex
}
```

Mismatched version on load → warning, not error (unless `schemaVersion` mismatch, which throws `IncompatibleSnapshotVersionError`).

## 13. Engine + CardDb compatibility

`game.attachCardDb(db)` validates:

```ts
if (!isCompatible(db.getVendoredForgeSha(), this.engineMinForgeSha)) {
  throw new IncompatibleCardDataError(
    `Engine expects Forge SHA compatible with ${this.engineMinForgeSha}, got ${db.getVendoredForgeSha()}`);
}
```

## 14. Error hierarchy

Defined in `@mtg-forge-ts/core/errors`:

```ts
abstract class ForgeError extends Error {}

// Data / loading
class UnknownCardError extends ForgeError { cardName: string; }
class UnknownHandlerError extends ForgeError { handlerKey: string; }
class ParseError extends ForgeError { location: SourceLocation; }
class IncompatibleCardDataError extends ForgeError {}
class IncompatibleCacheFormatError extends ForgeError {}
class IncompatibleSnapshotVersionError extends ForgeError {}

// Deck / format
class InvalidDeckError extends ForgeError { issues: DeckValidationIssue[]; }
class DeckContainsUnknownCardError extends ForgeError { names: string[]; }
class UnknownFormatError extends ForgeError {}
class UnregisteredRuleOverrideError extends ForgeError {}

// Game runtime
class GameStateIntegrityError extends ForgeError {}
class IllegalDecisionError extends ForgeError { legalOptions: unknown[]; }
class IllegalCastError extends ForgeError {}
class SnapshotRestoreError extends ForgeError {}
class DecisionLogCorruptError extends ForgeError {}

// AI
class UnknownAiProfileError extends ForgeError {}
class AiTimeBudgetExceededError extends ForgeError {}
```

Philosophy: fail loud. Any invariant violation throws. Consumer catches at boundaries.

## 15. Match + MatchController

Match wraps a series of Games in best-of-N:

```ts
class Match {
  id: string;
  players: LobbyPlayer[];
  rules: MatchRules;           // bestOf: 1 | 3 | 5, sideboardingAllowed, drawsAllowed, timeControl
  games: Game[];               // games played so far
  currentGame: Game | null;
  scores: Map<PlayerSeat, number>;
  matchController: Map<PlayerSeat, MatchController>;
  winner: PlayerSeat | Team | null;

  *run(): Generator<EngineYield, MatchOutcome, DecisionResponse> {
    while (!this.isTerminal()) {
      this.currentGame = this.constructGame();
      yield* this.currentGame.run();
      this.recordGameResult();
      if (!this.isTerminal()) {
        yield* this.sideboardingFlow();
      }
    }
    return this.computeOutcome();
  }

  *sideboardingFlow(): Generator<MatchDecisionRequest, void, MatchDecisionResponse> {
    for (const seat of this.sideboardOrder()) {
      const response = yield { kind: "sideboard", playerSeat: seat, mainDeck: ..., sideboard: ..., format: ... };
      this.applySideboard(seat, response);
    }
  }
}
```

## 16. Determinism enforcement

Lint rule (custom Biome rule) forbids in `@mtg-forge-ts/game` and `@mtg-forge-ts/ai`:
- `Math.random()`
- `Date.now()`, `new Date()` (except in pure reporting contexts — exempted via annotation)
- `crypto.randomUUID()`
- Iterating an unsorted collection where order affects output.

All randomness through injected `Rng`.

## 17. Testing strategy

- **Unit** per class in `core`: serialization round-trip, arithmetic on mana/cost, zone semantics, Rng reproducibility.
- **Unit** per class in `game` scaffold: GameAction mutation emits event, PhaseHandler transitions advance phase, Match lifecycle completes with recorded scores.
- **Property** (fast-check): Rng seeded reproducibility, EntityId uniqueness, zone-contents-sum-to-deck invariants.
- **Integration** (once more subsystems land): scripted no-op game runs to completion.

## 18. Phases

| Phase | Scope |
|---|---|
| **1a** | Core package skeleton: types, enums, branded IDs |
| **1b** | Core mana, cost, deck types |
| **1c** | Core DSL AST types (from SP3 spec) |
| **1d** | Core Rng + SeededRng implementation |
| **1e** | Core view types (GameView/PlayerView/CardView/etc.) |
| **1f** | Core event + decision type unions |
| **1g** | Core error hierarchy |
| **1h** | Game scaffold: Game, Player, Card, Zone class shells |
| **1i** | GameAction scaffold (signatures + stubbed bodies that throw) |
| **1j** | PhaseHandler + turn-based-actions scaffold |
| **1k** | Stack + Priority pump skeleton |
| **1l** | ManaPool + Cost payment generator |
| **1m** | Match + MatchController |
| **1n** | Serialization infra + GameSnapshot + restore |
| **1o** | Decision log + ScriptedController + RandomLegalController |
| **1p** | PlayerController interface + scaffolded humans controller adapter |
| **1q** | Game setup flow + mulligan + opening-hand actions scaffold |
| **1r** | Game-end flow + TerminalState |
| **1s** | Lint rule: no ambient randomness |
| **1t** | Integration smoke test: no-op scripted game runs to completion |

## 19. What SP1 does NOT cover

- Layer system, SBAs, triggers, replacements, static abilities, combat math, cast pipeline internals — SP2.
- DSL parser, handlers, SVar evaluator — SP3.
- Card database loading, editions — SP4.
- AI — SP5.
- Formats and legality — SP6.
- Limited — SP7.
- Tests and CI infrastructure — SP8 (though unit tests for SP1 are colocated).
