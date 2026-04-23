# SP5 — AI Engine

**Status:** Design approved
**Date:** 2026-04-23
**Package:** `@mtg-forge-ts/ai`
**Prerequisites:** SP1 (foundations), SP2 (rules), SP3 (sufficient handlers for end-to-end games), SP4 (card database)

---

## Purpose

Port Forge's AI class-for-class into the TypeScript engine. The library ships with three baseline profiles (`forge-easy`, `forge-medium`, `forge-hard`) matching Forge parity. The profile system is designed as a first-class extensibility surface so consumer apps (notably Mana and Life) can register tournament-tier profiles (FNM through Worlds) post-v1.0 without library changes.

## 1. Package responsibility

`@mtg-forge-ts/ai` owns:

- **`PlayerControllerAi`** — engine-facing adapter implementing the 22 `PlayerController` decision kinds.
- **`AiController`** — central decision-maker called by `PlayerControllerAi`.
- **`AiMatchController`** — implements 3 `MatchController` decision kinds (sideboarding, concede-match, accept-draw).
- **204 per-effect `SpellAbilityAi` classes** dispatched via `SpellApiToAi`.
- **`ComputerUtilMana`** — mana cost solver.
- **`ComputerUtilCombat`** — combat math simulator.
- **`AiAttackController`**, **`AiBlockController`** — combat planners.
- **`CreatureEvaluator`** — per-creature value estimator.
- **`GameStateEvaluator`** — full-game evaluator.
- **`GameCopier`** — deep-clone for simulation (ported from Forge's 510-line implementation).
- **`GameSimulator`** — runs hypothetical game futures.
- **`SimulationController`** — orchestrates sim per decision.
- **`SpecialCardAi` / `SpecialAiLogic`** — per-card AI overrides for ~100-200 famous cards.
- **`AiProfileRegistry`** — per-instance registry (not global) for profiles.
- **`AiCardMemory`** — per-turn decision memory.
- **`AiDeckBuilder`** + **`AiDeckStatistics`** — used by SP7 and for era-aware opponent deck generation.
- **AI decision logging** (opt-in, for debugging).

Depends on `@mtg-forge-ts/core`, `@mtg-forge-ts/cards`, `@mtg-forge-ts/game`. No reverse dependencies — the engine is AI-agnostic.

## 2. Top-level `AiController`

```ts
class AiController {
  constructor(
    readonly player: Player,
    readonly game: Game,
    readonly profile: AiProfile,
    readonly memory: AiCardMemory,
    readonly options: { debug?: boolean } = {},
  ) {}

  // Dispatched from PlayerControllerAi; one method per PlayerController decision kind.
  decidePriority(req: PriorityRequest): PriorityDecision;
  decideTargets(req: ChooseTargetsRequest): TargetsDecision;
  decideModes(req: ChooseModesRequest): ModesDecision;
  decideX(req: ChooseXRequest): XDecision;
  decideDistribute(req: DistributeRequest): DistributeDecision;
  decidePayment(req: ChoosePaymentRequest): PaymentDecision;
  decideOrderTriggers(req: OrderTriggersRequest): OrderDecision;
  decideOrderReplacements(req: OrderReplacementsRequest): OrderDecision;
  declareAttackers(req: DeclareAttackersRequest): AttackersDecision;  // delegates to AiAttackController
  declareBlockers(req: DeclareBlockersRequest): BlockersDecision;     // delegates to AiBlockController
  decideOrderBlockers(req: OrderBlockersRequest): OrderDecision;
  decideAssignDamage(req: AssignDamageRequest): AssignDamageDecision;
  decideChooseCard(req: ChooseCardRequest): CardChoiceDecision;
  decideChooseCardOrder(req: ChooseCardOrderRequest): CardOrderDecision;
  decideScry(req: ScryRequest): ScryDecision;
  decideSurveil(req: SurveilRequest): SurveilDecision;
  decideChooseOption(req: ChooseOptionRequest): OptionDecision;
  decideDeclareSplit(req: DeclareSplitRequest): SplitDecision;
  decideChoosePlayer(req: ChoosePlayerRequest): PlayerChoiceDecision;
  decideChooseZone(req: ChooseZoneRequest): ZoneChoiceDecision;
  decideChooseAltCost(req: ChooseAltCostRequest): AltCostDecision;
  decideMulligan(req: MulliganRequest): MulliganDecision;            // uses profile.overrides.chooseMulligan if set
  decideOpeningHandAction(req: OpeningHandRequest): OpeningHandDecision;
}
```

## 3. Priority decision — the main loop

The most important AI entry point. When the engine yields a priority request listing legal actions, `decidePriority`:

1. **Enumerate candidates** — spells castable from hand, activated abilities on controlled permanents, mana abilities, pass.
2. **Per-candidate fast evaluation** — query `SpellApiToAi.lookup(effectKind).evaluateAi(sa, ai, game)`. Returns signed score.
3. **Filter** candidates with negative score (unless no positive options exist).
4. **Simulate top-K** — for hard profiles, `SimulationController.simulate(candidate)` projects N turns ahead; refine score with simulation outcome.
5. **Pick best** — highest score wins; tie-break deterministically via seeded Rng.
6. **Cost sanity check** — verify AI can actually pay (`ComputerUtilMana.canPay`).
7. **Return decision**.

Budget cap: per profile (`profile.budgets.priorityDecisionMs`). If reached, return best-known option without further simulation.

## 4. `PlayerControllerAi` — engine bridge

Thin adapter:

```ts
class PlayerControllerAi implements PlayerController {
  constructor(
    seat: PlayerSeat,
    options: { profileId?: string; profileRegistry?: AiProfileRegistry; game: Game; player: Player },
  ) {
    const registry = options.profileRegistry ?? AiProfileRegistry.default();
    const profile = registry.get(options.profileId ?? "forge-medium");
    this.controller = new AiController(options.player, options.game, profile, new AiCardMemory());
  }

  decide(request: DecisionRequest): DecisionResponse {
    // Dispatch by request.kind to the appropriate AiController method
  }
}
```

`AiProfileRegistry` is **per-instance** (not global). Consumer constructs a registry, registers profiles, passes to `PlayerControllerAi`. Default registry available for simple cases.

## 5. `ComputerUtilMana` — mana cost solver

Constraint satisfaction + multi-objective optimization.

### Constraints

- Exact total cost met.
- Hybrid shards payable in either color.
- Phyrexian shards payable with 2 life OR color.
- Generic accepts any mana.
- Snow requires snow source.
- Colorless (`{C}`) only accepts colorless mana (not generic).

### Objectives (ordered)

1. Prefer non-basic lands for generic (basics more valuable for future fixing).
2. Prefer mana sources without downsides when tapped.
3. Prefer colorless / colored sources for generic only when over-produced.
4. Leave mana up for opponent-turn responses when AI has instant options in hand.
5. Use lands before artifacts (lands harder to remove).
6. Lower-X preferred for X-cost payments (unless X is optimized higher).

Port directly from Forge's `ComputerUtilMana` class (~1000 lines Java → similar TS).

### API

```ts
class ComputerUtilMana {
  canPay(cost: Cost, ai: Player, game: Game): boolean;
  buildPaymentPlan(cost: Cost, ai: Player, game: Game): PaymentPlan | null;
}
```

## 6. Combat AI

### `AiAttackController`

Input: AI's creatures, opposing players/planeswalkers/battles, game state.
Output: `(attacker, defender)` pairs.

Algorithm:
1. Filter creatures that can't attack (summoning sickness, tapped, static restrictions).
2. Enumerate legal defenders.
3. Heuristics per attacker:
   - Is lethal damage available this turn? (big weight yes-attack).
   - Can attacker survive combat? `ComputerUtilCombat` simulates per (attacker, defender) pair.
   - Is leaving back for defense more valuable? Weighted by opponent board threat (`CreatureEvaluator`).
   - Does attack count satisfy "swing-count" triggers (Battalion, Melee)?
4. Global optimization — try combinations for small counts; greedy for large.
5. Special-card overrides via `SpecialCardAi` (creatures with unusual attack semantics).

### `AiBlockController`

Input: attackers, AI's creatures, game state.
Output: blocker → attacker map.

Similar phase structure, inverted objective.

### `ComputerUtilCombat`

Shared combat math: simulates damage exchanges accounting for first strike, deathtouch, trample, lifelink, protection, ward, flying, reach, menace, banding, etc.

## 7. Per-effect AI — 204 classes via `SpellApiToAi`

For every `SpellAbilityEffect` class in `@mtg-forge-ts/game/src/ability/effects/` there's a parallel class `XEffectAi` in `@mtg-forge-ts/ai/src/ability/effects/`. Registered with `SpellApiToAi`.

### Base class

```ts
abstract class SpellAbilityAi {
  static readonly handlerKey: string;

  // Should the AI consider this at all? Cheap pre-filter.
  abstract canPlayAi(sa: SpellAbility, ai: Player, game: Game): boolean;

  // Value if played. Positive = good for AI.
  abstract evaluateAi(sa: SpellAbility, ai: Player, game: Game): number;

  // Target choice, called during cast. Returns null to abort.
  chooseTargetsAi(sa: SpellAbility, ai: Player, game: Game): TargetsDecision | null;

  // Mode choice for modal spells.
  chooseModesAi?(sa: SpellAbility, ai: Player, game: Game): ModesDecision;

  // X value choice.
  chooseXAi?(sa: SpellAbility, ai: Player, game: Game, maxX: number): number;
}
```

### Dispatch

```ts
class SpellApiToAi {
  static lookup(handlerKey: string): typeof SpellAbilityAi;
  static register(aiClass: typeof SpellAbilityAi): void;
}
```

When `AiController.decidePriority` considers Lightning Bolt, it looks up `DealDamageEffectAi` via `SpellApiToAi.lookup("DealDamage")` and calls its methods.

### Examples

- **`DealDamageEffectAi`** — canPlay: yes if target worth killing or opponent at lethal. evaluate: value of dead target − mana cost, bonus for lethal.
- **`DrawEffectAi`** — canPlay: almost always. evaluate: card-value × count − cost.
- **`CounterSpellEffectAi`** — canPlay: yes if opponent has a spell on stack worth countering.
- **`DestroyEffectAi`** — canPlay: yes if there's a target worth destroying (uses `CreatureEvaluator`).

Some classes share logic via inheritance (`PumpEffectAi` and `PumpAllEffectAi` share a base).

## 8. `CreatureEvaluator`

Per-creature value estimator in context.

Inputs: `Card` (live), game state.
Output: `number` (dimensionless score).

Factors:
- P/T: `power × 2 + toughness × 1.5` (default weights).
- Evasion: flying (+2), shadow (+3), horsemanship (+3), unblockable (+5), menace (+1).
- Keywords: deathtouch (+2), lifelink (+1), trample (+1), first strike (+1), double strike (+3), indestructible (+3).
- Counters: +1/+1 (+2 per), -1/-1 (-2 per).
- Attachments: aura/equipment contribution.
- Activated abilities: potency-weighted.
- Creature type: tribal-synergy bonus in-deck.

Weights tunable via `AiProfile.params.creatureEvalWeights`. Default weights from Forge's long-tuned values.

## 9. Game-tree simulation

For decisions where fast heuristics aren't enough, `SimulationController` branches into cloned game states, projects outcomes, picks best.

### Flow

```ts
*simulate(candidate: Candidate, profile: AiProfile): SimResult {
  // 1. Snapshot real game RNG state.
  const realRngState = game.rng.getState();
  // 2. Derive a single branchSeed.
  const branchSeed = game.rng.nextLong();
  // 3. For each branch (top-K candidates):
  const results: SimResult[] = [];
  for (const option of topK) {
    const clone = GameCopier.clone(game, branchSeed);  // every branch uses same seed
    const simulator = new GameSimulator(clone, profile);
    const outcome = simulator.runWithChoice(option, profile.params.simulationDepth);
    results.push(outcome);
  }
  // 4. Restore real RNG state.
  game.rng.setState(realRngState);
  return pickBest(results);
}
```

### Per A-3 and D-2 — RNG handling

- `GameCopier.clone(game, branchSeed)` takes an explicit seed for the clone's RNG.
- All branches use the **same** `branchSeed` (matches Forge's approach — branches differ by choice, not by randomness).
- Real game RNG state restored after sim (never advances during simulation).
- Parallel simulation is architecturally supported (instance RNG, no globals); deferred to post-v1 optimization.

### `GameSimulator`

```ts
class GameSimulator {
  constructor(private clone: Game, private profile: AiProfile) {}
  runWithChoice(choice: Choice, depth: number): SimResult {
    // Apply the choice, run the game for `depth` turns with profile-driven AI controllers, evaluate
  }
}
```

### `GameStateEvaluator`

Evaluates a full game state. Outputs a score for the AI.

Factors: life totals (own / opponents), permanents on battlefield (`CreatureEvaluator` sums), cards in hand, cards in library, counter advantage, combat position, next-turn threats.

### Budget

`profile.budgets.simulationMs` caps wall-clock. Early termination returns best-so-far.

## 10. Special-card AI (`SpecialCardAi`, `SpecialAiLogic`)

Cards where general heuristics misplay: Birthing Pod, Sneak Attack, Show and Tell, Necropotence, Wishes, combo enablers, tutors with specific targets.

Registry keyed by card name:

```ts
class SpecialCardAiRegistry {
  register(cardName: string, handler: SpecialCardAiHandler): void;
  get(cardName: string): SpecialCardAiHandler | null;
}

interface SpecialCardAiHandler {
  overrideDecision(card: Card, game: Game, ai: Player, decisionKind: string, params: unknown): unknown | null;
}
```

If registry has an entry for the card and decision kind, use it; otherwise fall back to general AI.

~100-200 cards in Forge; ported case-by-case prioritized by usage frequency.

## 11. Difficulty profiles — first-class extensibility

Baseline profiles bundled with v1.0: `forge-easy`, `forge-medium`, `forge-hard`. Ported from Forge's AI profile data in `res/ai/`.

### Profile schema

```ts
interface AiProfile {
  id: string;
  displayName: string;
  description: string;
  params: AiProfileParams;
  budgets: AiProfileBudgets;
  overrides?: AiProfileOverrides;
}

interface AiProfileParams {
  simulationDepth: number;
  simulationBranchFactor: number;
  misplayRate: number;
  riskTolerance: number;
  creatureEvalWeights: CreatureEvalWeights;
  tempoWeight: number;
  cardAdvantageWeight: number;
  lifeTotalWeight: number;
  mulliganAggressiveness: number;
  mulliganAlgorithm: "simple" | "london-pro" | "custom";
  bluffingEnabled: boolean;
  willingToTradeAtParity: boolean;
  useCombatTricksProactively: boolean;
  responseHoldBack: number;
  endOfTurnUsage: number;
  metagameAware: boolean;
  sideboardingQuality: "none" | "heuristic" | "expert";
  draftSignalReading: number;
  archetypeCoherenceWeight: number;
  knowledgeCutoffDate?: string;   // ISO date, for era-aware profiles
}

interface AiProfileBudgets {
  priorityDecisionMs: number;
  simulationMs: number;
  manaSolveMs: number;
  combatAiMs: number;
}

interface AiProfileOverrides {
  decidePriority?: PrioritySolver;
  chooseMulligan?: MulliganSolver;
  declareAttackers?: AttackerPlanner;
  declareBlockers?: BlockerPlanner;
  chooseTargets?: TargetChoiceSolver;
  // any of the 22 PlayerController decision kinds
}
```

### Registry (per-instance, not global)

```ts
class AiProfileRegistry {
  private constructor();
  static create(): AiProfileRegistry;
  static default(): AiProfileRegistry;           // ships with forge-easy/medium/hard registered

  register(profile: AiProfile): void;
  get(id: string): AiProfile;
  list(): AiProfile[];
  remove(id: string): void;
}
```

### Knowledge-cutoff enforcement (centralized filter, not scattered date checks)

```ts
class AiProfile {
  filterKnownCards(cards: CardDefinition[], game: Game): CardDefinition[] {
    if (!this.params.knowledgeCutoffDate) return cards;
    const cutoff = new Date(this.params.knowledgeCutoffDate);
    return cards.filter(c => c.firstReleaseDate <= cutoff);
  }
}
```

AI code funnels every card enumeration through this. Mana and Life's era-aware profiles benefit automatically.

## 12. `AiCardMemory`

Per-turn state so AI doesn't loop on the same considerations:

```ts
class AiCardMemory {
  private consideredForPlay: Set<EntityId> = new Set();
  private targetedForRemoval: Set<EntityId> = new Set();
  private combosInProgress: ComboToken[] = [];

  markConsideredForPlay(cardId: EntityId): void;
  hasConsideredForPlay(cardId: EntityId): boolean;
  markTargetedForRemoval(cardId: EntityId): void;
  // ...
  clearPerTurn(): void;    // called at end of each turn
}
```

Per-turn scope. Cleared on turn end.

## 13. Deck-building AI hints consumer

Card ASTs carry `AI:`, `DeckHas:`, `DeckHints:`, `DeckNeeds:` (per SP3 B-1). Consumers live in AI:

```ts
class AiDeckBuilder {
  buildDeck(pool: PaperCard[], format: Format, archetype: AiArchetype, profile: AiProfile): Deck;
}

class AiDeckStatistics {
  computeStats(deck: Deck): DeckStats;   // mana curve, threat density, interaction count, etc.
}
```

Used by SP7 (draft + sealed bots) and by any consumer wanting era-appropriate AI opponent decks.

## 14. AI decision logging (opt-in, for debugging)

```ts
new AiController(player, game, profile, memory, { debug: true });
```

When enabled:
- Every `decidePriority` logs: candidate list, per-candidate score, simulation results (if any), final pick, tie-break reason.
- Tagged with turn/phase/seat.
- Emitted via `GameEventBus` as `AiDecisionDebug` events.
- Not enabled by default (too noisy).

Consumer apps can subscribe and render (e.g., Mana and Life could show "AI thought..." breakdown in tournament replay).

## 15. Performance budgets

| Profile | priorityDecisionMs | simulationMs | manaSolveMs | combatAiMs |
|---|---:|---:|---:|---:|
| `forge-easy` | 20 | 0 (no sim) | 5 | 10 |
| `forge-medium` | 200 | 200 | 10 | 30 |
| `forge-hard` | 2000 | 1500 | 20 | 100 |

Custom profiles (post-v1) declare their own budgets. A `ml-worlds-champion` might set priorityDecisionMs: 30000 (30 seconds — pro player think time).

`GameCopier.clone` target: **<1ms per clone**. Benchmark-gated in CI. Miss fails the build.

## 16. Responsiveness

The AI is synchronous. Consumer apps put it on a non-UI thread:
- **Mana and Life (Electron)**: engine + AI in a `worker_thread`; UI thread stays responsive; cancellation via `worker.terminate()`.
- **The Conflux (Node server)**: request handler runs AI inline; concurrent requests naturally parallelize via Node's request model.
- **Docs (SP8)**: show recommended patterns.

No async in the AI. No cooperative yielding in AI. Budget caps wall-clock.

## 17. Post-v1.0 deferred work

Explicitly committed, deferred for calibration work:

### Tournament-tier profiles for Mana and Life

FNM tier 1/2, Regional, Grand Prix specialization, Pro Tour, Worlds — registered via `AiProfileRegistry.register()` by Mana and Life. Each requires dedicated tuning against its peer-level win rate.

### AI parallel simulation

Instance-scoped `Rng` supports parallel sim across worker threads. Not needed for v1.0 (budgets are soft); deferred optimization.

## 18. Testing strategy — win-rate comparison

- **Unit tests** per `SpellAbilityAi` class — scripted scenario, assert decision in acceptable set.
- **Mana solver tests** — fuzz-test against random mana configurations.
- **Combat math tests** — scripted combat scenarios with expected outcomes.
- **Win-rate regression** — 30 curated matchup fixtures (aggro vs control in Modern, etc.); pinned baselines with ±3pp tolerance. Nightly CI.
- **Win-rate parity with Forge** — matchups run through TS-AI and Forge-AI via SP0 harness; win rates within ±5pp.
- **Simulation determinism** — same seed + state → same decision. Property test.

## 19. Phases

| Phase | Scope |
|---|---|
| **5a** | `PlayerControllerAi` shell + `AiController` skeleton + `AiMatchController` + wiring into engine |
| **5b** | `ComputerUtilMana` mana solver |
| **5c** | `CreatureEvaluator` |
| **5d** | `ComputerUtilCombat` + `AiAttackController` + `AiBlockController` |
| **5e** | `GameCopier` port + `<1ms` benchmark |
| **5f** | `GameStateEvaluator` + `SimulationController` + `GameSimulator` |
| **5g** | `SpellApiToAi` registry + first 30 most-common `XEffectAi` subclasses |
| **5h** | Remaining 174 `XEffectAi` subclasses, prioritized by card usage frequency |
| **5i** | `AiCardMemory` + `AiProfileRegistry` + 3 default profiles |
| **5j** | `SpecialCardAi` for ~50 most-impactful cards |
| **5k** | `AiDeckBuilder` + `AiDeckStatistics` |
| **5l** | AI decision logging |
| **5m** | Win-rate regression suite + Forge parity benchmark |

After phase 5g, games against AI are playable (if rough). Remaining phases fill out the long tail.

## 20. What SP5 does NOT cover

- Machine learning / online adaptation — out of scope.
- Draft bot (uses `AiProfile` but lives in SP7 `@mtg-forge-ts/limited`).
- Format-specific heuristics — factored via profile params.
- Tournament-tier profiles — post-v1.0.
- AI tuning calibration — ongoing post-v1.0.
