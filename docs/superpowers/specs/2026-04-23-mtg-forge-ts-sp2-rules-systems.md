# SP2 — Rules Systems

**Status:** Design approved
**Date:** 2026-04-23
**Package:** `@mtg-forge-ts/game` (full implementation, post-SP1 scaffold)
**Prerequisites:** SP1 (engine foundations), SP0 (oracle, for correctness validation)

---

## Purpose

Implement the rule-enforcement machinery that turns SP1's scaffolded engine into an actual Magic engine. Layers, SBAs, triggers, replacements, static abilities, combat, the cast pipeline, and the long tail of MTG-specific subsystems (attachment, phasing, face-down, multi-face cards, copies, etc.) all live here. After SP2, a hand-built ability class can be played end-to-end with all rule interactions correctly resolved; SP3 then plugs in the mechanical DSL parser and 423 concrete handler implementations.

## 1. Layer system (`LayerEngine`)

Continuous effects apply in a fixed order of layers (CR 613). Card characteristics are computed by walking all 7 layers from the card's base state, with layer-internal ordering by dependency then timestamp.

### Layers

1. **Copy effects** (CR 613.1a) — "becomes a copy of X."
2. **Control-changing** — "gain control of X."
3. **Text-changing** — substitutes words in the card's rules text. Layers 4-7 then parse from the modified text.
4. **Type-changing** — "X is a creature" / "land becomes a creature."
5. **Color-changing** — "X is white."
6. **Ability-adding/removing** — "gains first strike" / "loses all abilities."
7. **Power/toughness**:
   - **7a** Characteristic-defining P/T (e.g. "*/* equal to X").
   - **7b** Set P/T ("becomes 3/3").
   - **7c** Modify P/T ("+2/+0 until end of turn").
   - **7d** Counters (+1/+1, -1/-1, and P/T-adjusting counters).
   - **7e** Switch P/T.

### Layer dependency resolution (CR 613.8)

Within a layer, effects apply in **dependency then timestamp** order:
- Effect A depends on effect B if applying B changes what A does, what A applies to, or makes A applicable to more/fewer objects, AND A has no reciprocal effect on B (asymmetric).
- Circular dependencies resolve to pure timestamp order.
- Non-dependent effects resolve by timestamp.

### Characteristic-defining abilities (CDAs)

CDAs apply in their appropriate layer before non-CDA effects in that layer (CR 604.3):
- P/T CDAs → Layer 7a (as above).
- Type CDAs → Layer 4 (before other type effects).
- Color CDAs → Layer 5 (before other color effects).

### Epoch-based cache

Invalidation-friendly caching:

```ts
class LayerEngine {
  private layerEpoch: number = 0;
  private cache: Map<EntityId, { chars: Characteristics, epoch: number }> = new Map();

  bumpEpoch(): void { this.layerEpoch++; this.cache.clear(); }
  computeCharacteristics(cardId: EntityId): Characteristics {
    const cached = this.cache.get(cardId);
    if (cached && cached.epoch === this.layerEpoch) return cached.chars;
    const chars = this.recompute(cardId);
    this.cache.set(cardId, { chars, epoch: this.layerEpoch });
    return chars;
  }
}
```

Epoch bumped on: card zone change, counter change, static ability register/unregister, continuous effect start/end, attachment change, control change, face-down flip, timestamp reassignment.

### Characteristics output

```ts
interface Characteristics {
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
  abilities: ActiveAbility[];
}
```

## 2. State-based actions (`SbaEngine`)

SBAs (CR 704.5a-v) are checked continuously, happen simultaneously, loop to fixpoint.

### Full SBA enumeration

Ported from CR 704.5 subsections:

1. Player with 0 or less life loses.
2. Player with 10+ poison counters loses.
3. Player who attempted to draw from empty library loses (when next drawing).
4. Creature with 0 or less toughness → graveyard.
5. Creature with damage ≥ toughness → destroyed.
6. Planeswalker with 0 or less loyalty → graveyard.
7. Battle with 0 or less defense → exiled.
8. Legend rule: two legendary permanents with same name, same controller → owner chooses one, others to graveyard.
9. World rule: two "world" permanents → newer leaves.
10. Token not in battlefield ceases to exist.
11. Aura attached to invalid object (or nothing) → graveyard.
12. Equipment attached to non-creature (or invalid) → becomes unattached.
13. Fortification attached to non-land → becomes unattached.
14. +1/+1 and -1/-1 counters on same permanent cancel pairwise.
15. Copies in non-battlefield zone cease to be copies (for non-tokens).
16. Phased-out permanent's owner leaves the game → permanent leaves game.
17. Saga with lore counters ≥ final chapter AND final chapter resolved → sacrificed.
18. Class permanent without a level counter → given level counter for its base level.
19. Commander in graveyard or exile whose owner wants it in command zone → to command zone (replacement effect, but triggered by SBA check context).
20. Day/Night: if currently day and active player cast no spells last turn → becomes night (and reverse). Actually: this is a turn-based action at beginning of upkeep, not an SBA. [Not an SBA; covered in TurnBasedActions.]
21. Bestowed aura not attached → reverts to creature form.
22. Planeswalker attacked alone target transfers when attacker dies (historical; no longer SBA post 2020).
... (~35 total across CR 704.5 subsections)

### Sweep-to-fixpoint

```ts
class SbaEngine {
  checkAll(): SbaActionBatch[] {
    const batches: SbaActionBatch[] = [];
    while (true) {
      const actions = this.collectApplicable();
      if (actions.length === 0) break;
      const batch = { actions, appliedAt: Date.now() };
      this.applyBatch(batch);
      batches.push(batch);
      // triggers queue (drained by orchestrator after return)
    }
    return batches;
  }
}
```

All applicable SBAs in one check are applied simultaneously (CR 704.3). Triggers queue. Next sweep checks again.

## 3. Triggered abilities (`TriggerRegistry`)

139 trigger handler types, dispatched by `Mode$` DSL value.

### Registry

```ts
class TriggerRegistry {
  register(trigger: TriggeredAbility): void;    // called on card zone-change into active-in zone
  unregister(trigger: TriggeredAbility): void;
  onEvent(event: GameEvent): void;              // called by GameAction after each mutation
  drainToStack(): TriggeredInstance[];          // called by orchestrator at priority windows
}
```

### APNAP ordering (CR 603.3b)

When multiple triggers fire from one event:
1. Active player stacks their own triggers in any order (yield `orderTriggers` decision).
2. Each non-active player, in turn order, does the same.
3. Stack bottom-up in that final order.

### Intervening "if" (CR 603.4)

Triggers with embedded conditions ("when X, if Y, do Z") check twice:
- At trigger time: if condition false, trigger doesn't fire.
- At resolve time: if condition false, effect doesn't apply.

### Trigger-time snapshot

Each fired trigger captures a snapshot of event context at firing time:
- LKI (last-known-information) of source/target cards for dies-triggers and leaves-triggers.
- Event parameters (damage amount, card drawn, etc.).
- Original controller at trigger time.

Snapshot lives on the stack-item until resolution.

### Delayed triggers

Created by resolving effects to fire later. One-shot by default; some are persistent. Stored in `game.pendingTriggers` with their triggering-condition and creation context.

### Linked abilities (CR 607)

When ability A exiles a card and ability B references "the exiled card," per-instance linkage tracks which exile happened from which activation. Stored on the ability instance, not the source card.

### Suppression

Static abilities can suppress triggers ("triggered abilities don't trigger" — Torpor Orb-class). Handled via StaticEffectRegistry contributing a restriction that `TriggerRegistry.register` checks.

## 4. Replacement effects (`ReplacementRegistry`)

46 replacement handler types. Intercept events before application.

### Kinds

- **Replace**: event B happens instead of A.
- **Redirect**: event A happens to different target.
- **Prevent**: event cancelled.
- **Self-replacement** (CR 614.1c-d): replacement specified by the object whose behavior is being modified.

### CR 616 ordering

When multiple replacements apply to the same event:
1. If there's a single **affected player**, they choose order.
2. Else if there's an **affected object**, its controller chooses.
3. Else **active player** chooses.

Yield `orderReplacements` decision to the chosen player.

### ETB self-replacement precedence (CR 614.1c-d)

For permanent-entering events, self-replacements (specified by the permanent's own text) apply before external replacements. Within self-replacements, CR 616 ordering applies.

### One-apply rule (CR 614.5)

Each replacement applies at most once per event. After applying, re-check remaining applicability (some may no longer apply; new ones may apply).

### Flow in GameAction

```ts
*apply(intent: MutationIntent): Generator<EngineYield, ApplyResult, DecisionResponse> {
  let current = intent;
  const appliedReplacements = new Set<EntityId>();
  while (true) {
    const applicable = this.gatherApplicable(current, appliedReplacements);
    if (applicable.length === 0) break;
    const orderer = this.selectOrderer(current);
    const order = applicable.length > 1
      ? (yield { kind: "orderReplacements", playerSeat: orderer, replacementIds: applicable.map(r => r.id) }).order
      : [applicable[0].id];
    for (const rid of order) {
      const replacement = applicable.find(r => r.id === rid)!;
      current = replacement.apply(current, this.game);
      appliedReplacements.add(rid);
      if (current === null) { yield { kind: "event", event: { kind: "EventPrevented", ... } }; return { prevented: true }; }
    }
  }
  // Apply the final intent
  this.applyFinal(current);
  yield { kind: "event", event: ... };
  return { prevented: false };
}
```

## 5. Static abilities (`StaticEffectRegistry`)

Active while source is in a specified zone (usually battlefield, sometimes graveyard/hand/exile/anywhere).

### Categories

- **Continuous characteristic** — contributes to layer engine.
- **Cost modification** — affects cost solver ("spells cost {1} less").
- **Can't/must/may** — affects decision validator / requirements.
- **Replacement-generating** — registers with ReplacementRegistry while active.
- **Prevention** — similar to replacement, for damage prevention shields.
- **Rule-changing** — overrides game rules ("you don't lose from 0 life").
- **Ability granting** — Layer 6 contribution.
- **Alternative costs** — adds entries to AltCostRegistry.

### Activation discipline

Card's static abilities are registered on zone-change INTO active-in zone. Unregistered on zone-change OUT. Card's `activeInZones: Set<ZoneType>` controls which zones activate.

## 6. Combat (`CombatHandler` + `CombatState`)

### Phase steps

1. **Beginning of combat** — last priority before attackers.
2. **Declare attackers** — active player designates attackers, their defenders (player/planeswalker/battle), tapping (unless vigilance), triggering attack-triggers.
3. **Declare blockers** — defending players designate blockers per attacker; if multiple blockers, active player sets damage-assignment order.
4. **First-strike damage step** (conditional) — if any first-strike/double-strike creatures in combat, this step runs; only first-strike + double-strike deal damage here.
5. **Combat damage** — creatures without first-strike (and double-strike again) deal damage.
6. **End of combat** — triggers fire, combat state clears.

### Damage assignment rules

- **Attacker with blockers**: attacker assigns damage to its blockers in the pre-declared order; minimum lethal to each before next gets any.
- **Trample** (CR 702.19): any damage assigned beyond what's needed for lethal to all blockers goes to defending player / planeswalker / battle.
- **Deathtouch** (CR 702.2): "any nonzero" counts as lethal for assignment.
- **Blocker blocking multiple attackers** (via banding/melee): damage split per order declared at block-declaration.
- **First strike** (CR 702.7), **Double strike** (CR 702.4), **Protection** (CR 702.16), **Ward** (CR 702.21), **Menace** (CR 702.110), **Flying/Reach** (CR 702.9/702.17), **Flanking** (CR 702.25), **Banding** (CR 702.22, CR 702.22s), **Shadow** (CR 702.27), **Horsemanship** (CR 702.30), **Rampage** (CR 702.23), **Ninjutsu** (CR 702.49), **Skulk** (CR 702.118), **Intimidate** (CR 702.13), **Fear** (CR 702.36), **Islandwalk/Swampwalk/etc.** — all implemented per CR.

### Simultaneous damage (CR 510.1c)

All damage-dealing in a damage step happens as one event. Replacements can target the batch or per-source. Triggers from damage fire after the whole batch resolves.

### Battles as defenders (CR 310)

- Attackable like planeswalkers.
- Attacker assigns damage reducing defense counters.
- When defense = 0 → exiled; "on defeat" ability resolves (often transforms and returns).

### Ninjutsu (CR 702.49)

Activated ability during declare-blockers step: swap an unblocked attacker for a creature from hand. `CombatHandler.ninjutsuSwap(unblockedAttackerId, replacementFromHand)`.

### Team combat (2HG et al.)

Defending team's life total is shared. Attack targets team (not individual player). Combat damage to team affects shared life pool.

## 7. Copy effects (`CopiableCharacteristics` + Layer 1)

Copies inherit **copiable values** (CR 707.2):
- Name, mana cost, color indicator, supertypes, types, subtypes, rules text, P/T, loyalty, defense.

Not copied: counters, damage, attachments, controller, tapped status, "memory" of past events.

### Implementation

- `Card.copiedFrom: CopiableCharacteristics | null`.
- `CopiableCharacteristics` captured at copy time from source's copiable values after its own Layer 1.
- Layer 1 of `LayerEngine`: apply copy effects in timestamp order, producing base-after-copy characteristics.
- Layers 2-7 then apply on top.

### Edge cases

- Token copying: the copy is a token unless effect says otherwise; inherits copied name (not "Copy Token").
- Copying DFC: by default, copy is single-faced with copied face's characteristics; not itself a DFC.
- Copying face-down card: copies 2/2 colorless typeless creature state; doesn't turn face-up later.
- Copying X-cost spell: X is copied as the chosen value (CR 707.10).
- Copies on stack (CR 707.10): stack-copy is a new StackItem with its own EntityId; inherits modes/targets/X; controller may retarget; not "cast" (no cast triggers); doesn't zone-change after resolution, just ceases.

## 8. Continuous effects from spells/abilities

Time-limited continuous effects:

```ts
interface ContinuousEffect {
  id: EntityId;
  sourceCardId: EntityId | null;           // null for emblems
  timestamp: number;
  layer: Layer;
  duration: EffectDuration;
  describe(): LayerEffect;
}

type EffectDuration =
  | { kind: "untilEndOfTurn" }
  | { kind: "untilEndOfYourNextTurn" }
  | { kind: "untilXLeavesBattlefield", xId: EntityId }
  | { kind: "asLongAs", condition: ConditionAst }
  | { kind: "permanent" }                   // emblems
  | { kind: "untilCombatEnds" }
  | { kind: "untilEndOfNextStep", step: PhaseStep };
```

Registered in `StaticEffectRegistry` (reused). `PhaseHandler` expires at appropriate times.

## 9. Cast pipeline (`CastPipeline`) — CR 601.2

10 sub-phases, each a generator step:

1. **Propose** — player announces intent to cast card X from zone Z.
2. **Choose face/side** — for modal/split/DFC/adventure.
3. **Choose zone override** — flashback uses graveyard; cascade-cast uses exile; etc.
4. **Choose alt/additional costs** — kicker, buyback, multikicker, replicate, conspire, bestow, foretell, splice, etc.
5. **Choose modes** — for modal spells; announce X value.
6. **Distribute** — "X damage divided as you choose."
7. **Choose targets** — subject to target restrictions.
8. **Determine total cost** — apply modifiers + replacements.
9. **Activate mana abilities** — player pays down cost; activates mana abilities between steps 9 and 10.
10. **Pay costs** — mana + non-mana simultaneously; completes casting.

After step 10, spell is on the stack. Triggers from casting fire.

### StackItemProvenance

Captured on the resulting StackItem:

```ts
interface StackItemProvenance {
  originZone: ZoneType;
  altCostUsed: AltCostKind | null;
  additionalCostsPaid: AdditionalCostKind[];
  cascadeOrigin?: EntityId;
  copiedFrom?: EntityId;
  alternativeZoneDestination?: ZoneType;   // e.g. Flashback → exile
}
```

Resolution consults provenance (e.g., flashback: exile after resolve).

### Abort + rollback

At any step, if player cancels or an invariant fails, the cast aborts:
1. Call distributed `undo()` on all CostParts paid so far.
2. Re-pay mana to pool via `ManaRefundService.refund`.
3. Reset any tentatively-mutated state.
4. Emit `CastAborted` event (once) with reason.
5. Discard buffered events since cast-begin boundary.

## 10. Priority / SBA orchestrator

Every state change triggers the following loop before active player receives priority:

```ts
*runPriorityWindow(): Generator<EngineYield, void, DecisionResponse> {
  while (true) {
    const didSomething = false;
    const batches = this.sbaEngine.sweep();
    if (batches.length > 0) didSomething = true;
    const pending = this.triggerRegistry.drainToStack();
    if (pending.length > 0) {
      yield* this.apnapOrderTriggers(pending);
      didSomething = true;
    }
    if (!didSomething) break;
  }
  yield { kind: "decision", request: { kind: "priority", playerSeat: this.game.activePlayer, legalActions: this.enumerateLegalActions() } };
}
```

## 11. Attachment subsystem

Auras, equipment, fortifications, augment/host.

```ts
// On Card:
interface Card {
  // ...
  attachedTo: EntityId | null;
  attachments: EntityId[];    // reverse index
}

class GameAction {
  *attach(sourceId: EntityId, targetId: EntityId, cause: AttachCause): Generator<...>;
  *unattach(sourceId: EntityId): Generator<...>;
}
```

SBAs enforce legality:
- Aura on invalid object → graveyard.
- Aura on nothing → graveyard.
- Equipment on non-creature → becomes unattached.
- Fortification on non-land → becomes unattached.

Layer 6 grants abilities from aura to enchanted object; when aura unattaches, abilities fall off.

Control-change preserves attachment. Zone-change (source or target) breaks attachment via SBA.

## 12. Face-down card machinery

States (each with its own turn-face-up conditions):

```ts
type FaceDownState =
  | { kind: "none" }
  | { kind: "morph", cost: ManaCost }
  | { kind: "manifest" }
  | { kind: "foretell", castableFrom: "exile" }
  | { kind: "disguise", wardAmount: number }
  | { kind: "cloak" };
```

While face-down:
- Characteristics: 2/2 colorless typeless creature, no name, no mana cost, no abilities (public view).
- True identity private to owner.
- Layer 1 of layer engine handles this at Characteristic level.

### Turn face-up

- Morph: pay morph cost as special action.
- Manifest: pay actual mana cost (only if creature).
- Foretell: cast from exile for foretell cost after the turn foretold.
- Disguise: pay disguise cost; has ward N.
- Cloak: pay actual mana cost (only if creature); has ward.

Turn-face-up events fire triggers ("when ~ is turned face up").

## 13. Phasing (CR 702.26)

```ts
// On Card:
interface Card {
  // ...
  phased: boolean;
}
```

- Phased-out permanents still "on the battlefield" rules-wise but invisible to most effects.
- At beginning of controller's untap step, permanents with phasing toggle phase state.
- Phased-out permanents don't untap, don't deal/receive damage, don't trigger.
- Zone-change while phased-out: permanent first phases in, then zone-changes.

## 14. Ownership vs control

`Card.ownerSeat` (frozen) vs `Card.controllerSeat` (mutable):
- Zone-change to non-battlefield goes to **owner's** zone (graveyard/hand/exile/library).
- Control change moves card between battlefields (per-player).
- Control effect ending: card returns to prior controller (moves between battlefields).
- At game-end event (CR 800.4): cards a player owns leave the game.

## 15. Multi-face cards

Taxonomy of multi-face cards and their handling:

### Split (e.g. Fire // Ice)
- One physical card, two independently castable halves.
- Each face has its own cost, types, rules text.
- Choose face at cast-pipeline step 2.
- Both faces' characteristics sum for purposes of "has both colors" etc. while in non-stack zones (CR 708).

### Aftermath (Split subtype)
- Back half castable only from graveyard.
- Exiles after use.

### Flip cards (Kamigawa)
- Single-face physically; flips in-place on condition.
- Post-flip card has different characteristics.
- Implemented as face swap on `Card.face: "front" | "flipped"`.

### Transform DFC
- Double-faced. Transforms via trigger (usually werewolves + day/night).
- `Card.face: "front" | "back"`; front is public unless transformed.

### Modal DFC
- Double-faced. Either face castable from hand.
- Unlike transform DFC, doesn't "transform" — the face you cast is what enters.

### Adventure
- Single card with creature + instant/sorcery "adventure" half.
- Adventure cast from hand; on resolve, exile (with "may cast this as a creature spell" permission).

### Meld
- Two specific named cards physically combine into one permanent.
- Third-face characteristics defined on the meld card script.

### Mutate
- Stacks creatures; host + mutating creatures share one permanent with merged abilities.
- Characteristic-defining from topmost + added abilities from all.

### Host + Augment (Unstable)
- Augment card attaches to host; combined characteristics.
- Special "combine" step in the augment mechanic.

Each has its own subsystem in `@mtg-forge-ts/game/src/multiface/`.

## 16. The Ring

Per-player `ringBearer: EntityId | null` and `ringLevel: 0-4`. Each level grants abilities to the ring-bearer:
- Level 1: Ring-bearer is legendary + can't be blocked by creatures with greater power.
- Level 2: Whenever attacks, each other creature target player controls gets -1/-1 until end of turn.
- Level 3: Whenever deals combat damage, each opponent loses 3 life.
- Level 4: Whenever attacks, ring-bearer gets +1/+1 and can't be countered or targeted by abilities your opponents control.

"The Ring tempts you" ability increments level and may change bearer.

Implemented as a game-level static effect that grants abilities based on `ringLevel` to the current `ringBearer`.

## 17. Turn queue + phase sequence (extra/skipped)

```ts
class TurnQueue {
  pushExtra(turn: Turn): void;
  injectSkip(count: number): void;
}

class PhaseSequence {
  injectExtraCombat(): void;
  skipStep(step: PhaseStep): void;
}
```

Extra-turn effects (Time Walk et al.): push onto queue.
Skip-your-next-turn: inject skip marker.
Additional combat phases: inject into current turn's sequence.
Skip untap step / draw step: skip at sequence level.

## 18. Loop detection + shortcut

Minimal engine hook:

```ts
class GameAction {
  requestShortcut(description: string, result: LoopResult): void {
    if (!this.validateShortcut(description, result)) {
      throw new IllegalDecisionError("Invalid loop shortcut", ...);
    }
    this.applyShortcutResult(result);
    this.emitEvent({ kind: "ShortcutApplied", ... });
  }
}
```

Validation: result must be reachable by the described loop; all intermediate states must form a closed cycle.

Loop detection (when to offer shortcut) is mostly an AI concern (SP5). Engine just provides the primitive.

## 19. Stack-copy mechanics

```ts
class Stack {
  copy(sourceItemId: EntityId, newController: PlayerSeat, options: { changeTargets?: TargetChoices }): StackItem {
    const source = this.items.find(i => i.id === sourceItemId)!;
    const copy: StackItem = {
      ...source,
      id: this.game.entityIdCounter++,
      controllerSeat: newController,
      targets: options.changeTargets ?? source.targets,
      kind: "copy",
      isCast: false,
    };
    this.items.push(copy);
    return copy;
  }
}
```

On resolution, copy doesn't zone-change; just ceases. No cast triggers from copies.

## 20. Resolve-time decisions

Effect `resolve()` methods are themselves generators; they may yield sub-decisions:

```ts
*resolve(sa: SpellAbility, game: Game): Generator<EngineYield, void, DecisionResponse> {
  const may = yield { kind: "chooseOption", sourceId: sa.id, options: ["yes", "no"] };
  if (may.choice === "yes") {
    yield* game.action.drawCards(sa.controllerSeat, 2);
  }
}
```

## 21. Testing strategy

- **Unit** per subsystem (LayerEngine, SbaEngine, TriggerRegistry, etc.).
- **Fixture** for each trigger kind, each replacement kind, each SBA, each combat scenario (first-strike, deathtouch, trample, protection, ward).
- **Property** invariants: no-damaged-dead-creature-after-SBA, stack-is-LIFO, mana-pool-empties-at-phase-boundary, zone-consistency.
- **Golden-master** scenarios (SP0) covering major interactions — combat, stack, layer interactions, commander rules, legend rule, copy effects.

## 22. Phases

| Phase | Scope |
|---|---|
| **2a** | TargetSystem + target legality at cast and resolve |
| **2b** | Layer engine + epoch cache + dependency resolver |
| **2c** | SBA engine + fixpoint loop + all 35 SBA implementations |
| **2d** | Trigger registry + APNAP ordering + LKI handling + delayed triggers + linked abilities |
| **2e** | Replacement registry + CR 616 ordering + ETB self-replacement + one-apply rule |
| **2f** | Static effect registry + zone-activation discipline |
| **2g** | Combat handler + combat state + damage assignment + first-strike split |
| **2h** | Combat keywords (trample, deathtouch, first/double strike, protection, ward, flying, reach, menace, flanking, banding, ninjutsu) |
| **2i** | Copy effects + Layer 1 + copiable characteristics |
| **2j** | Continuous effects + duration machinery + phase-expiry |
| **2k** | Cast pipeline (all 10 steps) + generator integration + abort-rollback |
| **2l** | Priority + SBA orchestrator loop |
| **2m** | Attachment subsystem |
| **2n** | Face-down machinery (morph/manifest/foretell/disguise/cloak) |
| **2o** | Phasing |
| **2p** | Ownership vs control + zone routing |
| **2q** | Multi-face card subsystems (split/aftermath/flip/transform-DFC/modal-DFC/adventure/meld/mutate/host+augment) |
| **2r** | The Ring + temptation mechanic |
| **2s** | Turn queue + phase sequence (extra/skipped) |
| **2t** | Loop detection hook + shortcut primitive |
| **2u** | Stack-copy mechanics |
| **2v** | Full event taxonomy enumerated + versioned |
| **2w** | Game-end flow + game-loss cleanup (CR 800.4) + terminal state |

## 23. What SP2 does NOT cover

- Concrete 204+139+46+34 handler implementations — SP3.
- DSL parser — SP3.
- Card data loading — SP4.
- AI — SP5.
- Format-specific rule overrides beyond the registry hook — SP6 plugs in commander/brawl/etc.
- Limited-specific state — SP7.
