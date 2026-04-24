// SPDX-License-Identifier: GPL-3.0-or-later
// GameAction — generator-based mutation API over Game state. Every mutating
// operation is a generator function that:
//   1. builds a typed MutationIntent describing the pending mutation,
//   2. routes through applyReplacementLoop (CR 614) via applyWithReplacements,
//   3. emits ReplacementApplied per replacement id that fired, then either
//      EventPrevented (on prevention) or the canonical GameEvent + actual
//      state mutation (on apply, using the possibly-mutated final intent).
//
// SP1 shape emitted the canonical event and mutated state directly. SP2
// Task 19 layers replacement routing on top without changing the public
// generator signatures. Triggers (Milestone E) observe the canonical events
// downstream of this routing. State-based-actions (Milestone G) run outside
// GameAction.
//
// SP3 fills in costs (the `_cost` / `costPaid` slots currently `unknown`).
//
// Why generators: the driver needs to pause mid-mutation to ask controllers
// for decisions (choose order of replacements, scry order, blocker orders,
// etc.). Generators make the pause-and-resume contract explicit at the
// type-system level via the EngineYield union.
import type {
  CounterType,
  EntityId,
  GameEvent,
  MutationIntent,
  PlayerSeat,
  ZoneType,
} from "@mtg-forge-ts/core";
import { GameStateIntegrityError, IllegalDecisionError, ZoneType as Zt, mkEvent } from "@mtg-forge-ts/core";
import type { Game } from "../game.js";
import { applyReplacementLoop } from "../replacements/apply-loop.js";
import type {
  AddCounterIntent,
  ControlChangeIntent,
  DamageIntent,
  DestroyIntent,
  DrawCardsIntent,
  ExileIntent,
  LifeChangeIntent,
  MillIntent,
  MoveToIntent,
  RemoveCounterIntent,
  SacrificeIntent,
  TapIntent,
  UntapIntent,
} from "../replacements/mutation-intent.js";
import type { StackItem } from "../stack/stack-item.js";
import type { Zone } from "../zone/zone.js";
import type { EngineYield } from "./engine-yield.js";

// Local union of every intent kind GameAction routes. Kept here (not in
// mutation-intent.ts) because applyWithReplacements is the only consumer
// that needs the narrowed generic bound.
type RoutedIntent =
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
  | ControlChangeIntent;

export class GameAction {
  constructor(private readonly game: Game) {}

  // === Replacement-routing helper (SP2 Task 19) ===

  /**
   * Route a single mutation intent through the replacement apply-loop and
   * emit the appropriate engine events around the actual state mutation.
   *
   * Control flow:
   *   1. yield* applyReplacementLoop(intent, game) — pauses for CR 616
   *      ordering decisions if more than one replacement is applicable.
   *   2. For each id in appliedIds, emit ReplacementApplied (carries the
   *      original + replaced intent so observers see the pre/post pair).
   *   3. If status === "prevented": emit EventPrevented with the original
   *      intent and return { prevented: true }. Skip mutation + canonical
   *      event.
   *   4. If status === "applied": invoke onApplied(final) so the caller
   *      performs the real state mutation based on the (possibly mutated)
   *      final intent, then emit the canonical event derived from final.
   *
   * WHY one helper: every mutator pays the same choreography — gather,
   * order, apply, emit. Factoring it here keeps the per-mutator code
   * focused on (a) building the intent and (b) the onApplied callback.
   *
   * Per reviewer C1: we never short-circuit the yield* even when the
   * registry is empty. The apply-loop itself handles the empty case in a
   * single Map iteration and returns status:"applied" with the input
   * intent. Keeping the call uniform guarantees consistent event emission.
   *
   * Per reviewer C2: event emission lives here, not inside apply-loop.
   * apply-loop stays pure — it only yields orderReplacements decisions.
   */
  private *applyWithReplacements<I extends RoutedIntent>(
    intent: I,
    onApplied: (final: I) => void,
    buildCanonicalEvent: (final: I) => GameEvent,
  ): Generator<EngineYield, { readonly prevented: boolean }, unknown> {
    const game = this.game;
    // WHY cast through unknown: MutationIntent is declared in core as
    // `Readonly<Record<string, unknown>> & { kind: string }` — an index-
    // signatured shape — and our concrete intent types (DamageIntent,
    // MoveToIntent, …) omit the string index signature. Structural
    // compatibility flows one way: concrete → generic requires a widening
    // cast. The runtime shape is identical.
    const result = yield* applyReplacementLoop(intent as unknown as MutationIntent, game);
    // Emit ReplacementApplied per fired replacement, in apply order. On
    // prevent, `replaced` is null (the last replacement returned null);
    // on apply, `replaced` is the final intent after the full chain.
    // WHY not per-step snapshots: SP2 event payload is {original, replaced}
    // for the whole chain (Task 12 payload shape). Per-step intermediate
    // states are SP3 if anyone ever needs them.
    const replaced = result.status === "applied" ? result.final : null;
    for (const rid of result.appliedIds) {
      yield {
        kind: "event",
        event: mkEvent("ReplacementApplied", game.turn, game.phase, {
          replacementId: rid,
          original: intent,
          replaced,
        }),
      };
    }
    if (result.status === "prevented") {
      yield {
        kind: "event",
        event: mkEvent("EventPrevented", game.turn, game.phase, { original: intent }),
      };
      return { prevented: true };
    }
    if (result.status !== "applied") {
      // Exhaustiveness guard — ApplyResult is a two-variant union.
      const _never: never = result;
      throw new Error(`GameAction.applyWithReplacements: unexpected status ${String(_never)}`);
    }
    const final = result.final as I;
    onApplied(final);
    yield { kind: "event", event: buildCanonicalEvent(final) };
    return { prevented: false };
  }

  // === Draw + life + zone movement (SP1 implemented) ===

  *drawCards(
    seat: PlayerSeat,
    count: number,
    _opts?: { readonly cause?: string },
  ): Generator<EngineYield, void, unknown> {
    const game = this.game;
    const player = game.getPlayer(seat);
    const library = player.zones.get(Zt.Library);
    const hand = player.zones.get(Zt.Hand);
    if (!library) throw new GameStateIntegrityError(`Player ${seat} has no Library zone`);
    if (!hand) throw new GameStateIntegrityError(`Player ${seat} has no Hand zone`);
    // WHY per-card intents: CR 121.3 treats each individual card draw as the
    // event a replacement can intercept ("if you would draw a card, instead
    // …"). A batched draw must expose N separate replacement points. SP2
    // keeps this simple by looping in the mutator; triggers (Milestone E)
    // collapse the batch back into a single summary as needed.
    for (let i = 0; i < count; i++) {
      // WHY: Forge/Java convention — index 0 is the TOP of the library.
      // Draw consumes the front of the list; items.length-1 is the bottom.
      const topId = library.peekAt(0);
      // WHY: running out of library mid-draw is a state-based loss condition
      // (SP2). For SP1 we simply stop drawing — the caller can detect this
      // via Library.size beforehand. Emitting CardDrawn with no card would
      // violate the event contract.
      if (topId === undefined) return;
      const intent: DrawCardsIntent = { kind: "drawCards", seat, count: 1 };
      yield* this.applyWithReplacements<DrawCardsIntent>(
        intent,
        (_final) => {
          // WHY no cardId on the intent: a draw replacement (e.g. "if you
          // would draw a card, instead …") operates on the draw, not the
          // specific card. SP3 can introduce richer draw intents if needed.
          // We re-read the top here because a replacement may have mutated
          // library state (e.g. scry-on-draw) before the actual draw fires.
          // Per current SP2 scope, replacements don't mutate the library,
          // but the read is cheap and defensive.
          const removed = library.removeAt(0);
          if (removed === undefined) return;
          hand.add(removed);
          const card = game.cards.get(removed);
          if (card) card.zone = Zt.Hand;
        },
        (_final) =>
          mkEvent("CardDrawn", game.turn, game.phase, {
            playerSeat: seat,
            cardId: topId,
          }),
      );
    }
  }

  *changeLife(
    seat: PlayerSeat,
    delta: number,
    opts?: { readonly cause?: string },
  ): Generator<EngineYield, void, unknown> {
    const game = this.game;
    const player = game.getPlayer(seat);
    const intent: LifeChangeIntent = {
      kind: "lifeChange",
      seat,
      delta,
      cause: opts?.cause ?? "effect",
    };
    yield* this.applyWithReplacements<LifeChangeIntent>(
      intent,
      (final) => {
        player.life = player.life + final.delta;
      },
      (final) => {
        // oldLife/newLife derived at emit-time from the final (possibly
        // replaced) delta against the CURRENT player.life. Because
        // onApplied already ran, player.life reflects the post-apply value.
        const newLife = player.life;
        const oldLife = newLife - final.delta;
        return mkEvent("LifeChanged", game.turn, game.phase, {
          playerSeat: final.seat,
          oldLife,
          newLife,
          delta: final.delta,
          cause: final.cause,
        });
      },
    );
  }

  *moveTo(
    cardId: EntityId,
    toZone: ZoneType,
    opts?: { readonly toSeat?: PlayerSeat; readonly cause?: string },
  ): Generator<EngineYield, void, unknown> {
    const game = this.game;
    const { fromZone, owner } = this.locate(cardId);
    const toSeat = opts?.toSeat ?? this.defaultDestinationSeat(toZone, owner);
    const intent: MoveToIntent = {
      kind: "moveTo",
      cardId,
      toZone,
      toSeat,
      cause: opts?.cause ?? "effect",
    };
    yield* this.applyWithReplacements<MoveToIntent>(
      intent,
      (final) => {
        // Re-resolve from/to on final because a replacement may have
        // rewritten the target zone (e.g. "if this card would go to the
        // graveyard, exile it instead"). `fromZone/owner` were captured
        // before the loop and are correct (replacements cannot rewrite the
        // source zone — the card is where it is).
        const from = this.zoneFor(fromZone, owner);
        const to = this.zoneFor(final.toZone, final.toSeat);
        from.remove(final.cardId);
        to.add(final.cardId);
        const card = game.cards.get(final.cardId);
        if (card) {
          card.zone = final.toZone;
          if (final.toSeat !== null) card.controllerSeat = final.toSeat;
        }
        // CR 613.1 — zone change alters which continuous effects apply
        // (layered values are defined only for permanents on the battlefield,
        // etc.); invalidate the cache so the next characteristics read
        // re-derives from the new zone. Inside onApplied so prevented moves
        // don't churn the cache.
        game.layerEngine.bumpEpoch("moveTo");
      },
      (final) =>
        mkEvent("CardChangedZone", game.turn, game.phase, {
          cardId: final.cardId,
          fromZone,
          toZone: final.toZone,
          ...(owner !== null ? { fromSeat: owner } : {}),
          ...(final.toSeat !== null ? { toSeat: final.toSeat } : {}),
          ...(opts?.cause !== undefined ? { cause: opts.cause } : {}),
        }),
    );
  }

  // === Tap/untap ===

  *tap(cardId: EntityId): Generator<EngineYield, void, unknown> {
    const card = this.game.cards.get(cardId);
    // WHY pre-check before building intent: idempotent no-op on a missing
    // card or already-tapped permanent — no replacement chain for
    // non-events. SP2 trigger handlers listening on CardTapped do not fire
    // on redundant tap() calls per Forge semantics; skipping the intent
    // also skips replacement gather, matching reality.
    if (!card || card.tapped) return;
    const intent: TapIntent = { kind: "tap", cardId };
    yield* this.applyWithReplacements<TapIntent>(
      intent,
      (final) => {
        const c = this.game.cards.get(final.cardId);
        if (!c) return;
        c.tapped = true;
        // Tapped-state can gate continuous effects (e.g. "as long as
        // CARDNAME is tapped"). Bump only inside onApplied so prevention
        // doesn't churn the cache.
        this.game.layerEngine.bumpEpoch("tap");
      },
      (final) => mkEvent("CardTapped", this.game.turn, this.game.phase, { cardId: final.cardId }),
    );
  }

  *untap(cardId: EntityId): Generator<EngineYield, void, unknown> {
    const card = this.game.cards.get(cardId);
    if (!card || !card.tapped) return;
    const intent: UntapIntent = { kind: "untap", cardId };
    yield* this.applyWithReplacements<UntapIntent>(
      intent,
      (final) => {
        const c = this.game.cards.get(final.cardId);
        if (!c) return;
        c.tapped = false;
        this.game.layerEngine.bumpEpoch("untap");
      },
      (final) => mkEvent("CardUntapped", this.game.turn, this.game.phase, { cardId: final.cardId }),
    );
  }

  // === Destroy / exile / sacrifice — event + zone change via moveTo ===

  *destroy(
    cardId: EntityId,
    opts?: { readonly sourceId?: EntityId; readonly cause?: "damage" | "sba" | "effect" },
  ): Generator<EngineYield, void, unknown> {
    // Two-step flow: the destroy-intent fires first (regeneration-class
    // replacements intercept here), then a separate moveTo-intent to
    // Graveyard fires (zone-change replacements intercept there). If
    // destroy is prevented, we do NOT proceed to moveTo.
    const intent: DestroyIntent = {
      kind: "destroy",
      cardId,
      sourceId: opts?.sourceId ?? null,
      cause: opts?.cause ?? "effect",
    };
    const outcome = yield* this.applyWithReplacements<DestroyIntent>(
      intent,
      (_final) => {
        // Destroy itself is a pure event + follow-up zone move. The zone
        // move happens after (outside) applyWithReplacements so it
        // participates in its own replacement chain.
      },
      (final) =>
        mkEvent("CardDestroyed", this.game.turn, this.game.phase, {
          cardId: final.cardId,
          ...(final.sourceId !== null ? { sourceId: final.sourceId } : {}),
          cause: final.cause,
        }),
    );
    if (outcome.prevented) return;
    yield* this.moveTo(cardId, Zt.Graveyard);
  }

  *exile(cardId: EntityId, opts?: { readonly sourceId?: EntityId }): Generator<EngineYield, void, unknown> {
    const { fromZone } = this.locate(cardId);
    const intent: ExileIntent = {
      kind: "exile",
      cardId,
      sourceId: opts?.sourceId ?? null,
    };
    const outcome = yield* this.applyWithReplacements<ExileIntent>(
      intent,
      (_final) => {
        // Follow-up moveTo performs the zone change (and its own
        // replacement chain).
      },
      (final) =>
        mkEvent("CardExiled", this.game.turn, this.game.phase, {
          cardId: final.cardId,
          fromZone,
          ...(final.sourceId !== null ? { sourceId: final.sourceId } : {}),
        }),
    );
    if (outcome.prevented) return;
    yield* this.moveTo(cardId, Zt.Exile);
  }

  *sacrifice(
    cardId: EntityId,
    opts?: { readonly sourceId?: EntityId },
  ): Generator<EngineYield, void, unknown> {
    const { owner } = this.locate(cardId);
    if (owner === null) {
      throw new GameStateIntegrityError(`Cannot sacrifice ${cardId} — not owned by any player`);
    }
    const intent: SacrificeIntent = {
      kind: "sacrifice",
      cardId,
      playerSeat: owner,
      sourceId: opts?.sourceId ?? null,
    };
    const outcome = yield* this.applyWithReplacements<SacrificeIntent>(
      intent,
      (_final) => {
        // Follow-up moveTo performs the zone change.
      },
      (final) =>
        mkEvent("CardSacrificed", this.game.turn, this.game.phase, {
          cardId: final.cardId,
          playerSeat: final.playerSeat,
          ...(final.sourceId !== null ? { sourceId: final.sourceId } : {}),
        }),
    );
    if (outcome.prevented) return;
    yield* this.moveTo(cardId, Zt.Graveyard);
  }

  // === Damage ===

  *damage(
    sourceId: EntityId,
    targetKind: "creature" | "player" | "planeswalker" | "battle",
    targetId: EntityId | PlayerSeat,
    amount: number,
    isCombat: boolean,
  ): Generator<EngineYield, void, unknown> {
    const game = this.game;
    const intent: DamageIntent = {
      kind: "damage",
      sourceId,
      targetKind,
      targetId,
      amount,
      isCombat,
    };
    yield* this.applyWithReplacements<DamageIntent>(
      intent,
      (final) => {
        // WHY: damage to a creature updates Card.damage; damage to a player
        // updates Player.life via a follow-up LifeChanged. SP1 keeps this
        // minimal — the damage marker is applied; life deduction is a
        // state-based-action step that Milestone G will emit.
        if (final.targetKind === "creature" && typeof final.targetId === "number") {
          const card = game.cards.get(final.targetId as EntityId);
          if (card) card.damage += final.amount;
        }
      },
      (final) =>
        mkEvent("DamageDealt", game.turn, game.phase, {
          sourceId: final.sourceId,
          targetKind: final.targetKind,
          targetId: final.targetId,
          amount: final.amount,
          isCombat: final.isCombat,
        }),
    );
  }

  // === Counters ===

  *addCounter(
    cardId: EntityId,
    counterType: CounterType,
    amount: number,
    sourceId?: EntityId,
  ): Generator<EngineYield, void, unknown> {
    // WHY: counter amounts are always positive integers per MTG rules.
    // Accepting 0 or negatives silently (the old behavior) let bugs
    // propagate through to observers and persisted state. Callers that
    // need "remove N" must use removeCounter.
    if (!Number.isInteger(amount) || amount <= 0) {
      throw new IllegalDecisionError(`addCounter: amount must be a positive integer, got ${amount}`);
    }
    const game = this.game;
    const intent: AddCounterIntent = {
      kind: "addCounter",
      cardId,
      counterType,
      amount,
      sourceId: sourceId ?? null,
    };
    yield* this.applyWithReplacements<AddCounterIntent>(
      intent,
      (final) => {
        const card = game.cards.get(final.cardId);
        if (card) {
          const current = card.counters.get(final.counterType) ?? 0;
          card.counters.set(final.counterType, current + final.amount);
        }
        // Counters feed Layer 7d (P/T) and can gate other continuous
        // effects (e.g. "as long as CARDNAME has a +1/+1 counter on it").
        // Epoch bump lives inside onApplied so preventions don't churn.
        game.layerEngine.bumpEpoch("counter");
      },
      (final) =>
        mkEvent("CounterAdded", game.turn, game.phase, {
          cardId: final.cardId,
          counterType: final.counterType,
          amount: final.amount,
          ...(final.sourceId !== null ? { sourceId: final.sourceId } : {}),
        }),
    );
  }

  *removeCounter(
    cardId: EntityId,
    counterType: CounterType,
    amount: number,
    sourceId?: EntityId,
  ): Generator<EngineYield, void, unknown> {
    if (!Number.isInteger(amount) || amount <= 0) {
      throw new IllegalDecisionError(`removeCounter: amount must be a positive integer, got ${amount}`);
    }
    const game = this.game;
    const card = game.cards.get(cardId);
    // WHY: Forge no-ops when the targeted counter type isn't present on
    // the card; that matches CR 122.1 ("you can't remove a counter that
    // isn't there"). Emitting CounterRemoved anyway would falsely signal
    // an observable change to trigger/event subscribers. Pre-check before
    // building the intent — no replacement chain for non-events.
    if (!card || !card.counters.has(counterType)) {
      return;
    }
    const intent: RemoveCounterIntent = {
      kind: "removeCounter",
      cardId,
      counterType,
      amount,
      sourceId: sourceId ?? null,
    };
    yield* this.applyWithReplacements<RemoveCounterIntent>(
      intent,
      (final) => {
        const c = game.cards.get(final.cardId);
        if (!c || !c.counters.has(final.counterType)) return;
        const current = c.counters.get(final.counterType) ?? 0;
        const next = Math.max(0, current - final.amount);
        if (next === 0) c.counters.delete(final.counterType);
        else c.counters.set(final.counterType, next);
        // Counter change → bump. The pre-check above plus this guard
        // ensure we only reach state-mutation on an observable change.
        game.layerEngine.bumpEpoch("counter");
      },
      (final) =>
        mkEvent("CounterRemoved", game.turn, game.phase, {
          cardId: final.cardId,
          counterType: final.counterType,
          amount: final.amount,
          ...(final.sourceId !== null ? { sourceId: final.sourceId } : {}),
        }),
    );
  }

  // === Control change ===

  *changeControl(
    cardId: EntityId,
    newController: PlayerSeat,
    sourceId?: EntityId,
  ): Generator<EngineYield, void, unknown> {
    const game = this.game;
    const card = game.cards.get(cardId);
    const oldController = card?.controllerSeat;
    if (oldController === undefined) {
      throw new GameStateIntegrityError(`changeControl: card ${cardId} not tracked`);
    }
    const intent: ControlChangeIntent = {
      kind: "controlChange",
      cardId,
      newController,
      sourceId: sourceId ?? null,
    };
    yield* this.applyWithReplacements<ControlChangeIntent>(
      intent,
      (final) => {
        const c = game.cards.get(final.cardId);
        if (c) c.controllerSeat = final.newController;
        // CR 613.1b — control change invalidates the LayerEngine cache
        // because layered values scoped by controller (e.g., ability-grant
        // statics) must re-evaluate. Bump before the event emit so
        // observers reading characteristics during the event see the
        // post-control-change view.
        game.layerEngine.bumpEpoch("control-change");
      },
      (final) =>
        mkEvent("ControlChanged", game.turn, game.phase, {
          cardId: final.cardId,
          oldController,
          newController: final.newController,
          ...(final.sourceId !== null ? { sourceId: final.sourceId } : {}),
        }),
    );
  }

  // === Stack push ===

  *putOnStack(item: StackItem): Generator<EngineYield, void, unknown> {
    const game = this.game;
    // WHY no replacement routing: CR 614 replacement effects apply to
    // "events" — game-state mutations — not to stack bookkeeping. Stack
    // placement of a spell/ability happens as part of the cast process
    // (CR 601), which has its own intercept points (cast restrictions,
    // counterspells). Re-intercepting stack push through the replacement
    // chain would double-dip.
    game.sharedZones.stack.push(item);
    if (item.kind === "spell" || item.kind === "copy") {
      yield {
        kind: "event",
        event: mkEvent("SpellPutOnStack", game.turn, game.phase, {
          stackItemId: item.id,
          cardId: item.sourceCardId,
          controllerSeat: item.controllerSeat,
        }),
      };
    } else {
      yield {
        kind: "event",
        event: mkEvent("AbilityActivated", game.turn, game.phase, {
          stackItemId: item.id,
          sourceCardId: item.sourceCardId,
          controllerSeat: item.controllerSeat,
          abilityKind: "activated",
        }),
      };
    }
  }

  // === Mill + shuffle (SP1 implemented) ===

  *mill(seat: PlayerSeat, count: number): Generator<EngineYield, void, unknown> {
    const game = this.game;
    const player = game.getPlayer(seat);
    const library = player.zones.get(Zt.Library);
    if (!library) throw new GameStateIntegrityError(`Player ${seat} has no Library zone`);
    const graveyard = player.zones.get(Zt.Graveyard);
    if (!graveyard) {
      throw new GameStateIntegrityError(`Player ${seat} has no Graveyard zone`);
    }
    // Per-card intents so each mill card is an individual replacement
    // event (mirror of per-card drawCards — "if you would mill a card,
    // instead …" is a per-card hook).
    for (let i = 0; i < count; i++) {
      const topId = library.peekAt(0);
      if (topId === undefined) return;
      const intent: MillIntent = { kind: "mill", seat, count: 1 };
      yield* this.applyWithReplacements<MillIntent>(
        intent,
        (_final) => {
          const removed = library.removeAt(0);
          if (removed === undefined) return;
          graveyard.add(removed);
          const card = game.cards.get(removed);
          if (card) card.zone = Zt.Graveyard;
        },
        (_final) =>
          mkEvent("CardMilled", game.turn, game.phase, {
            playerSeat: seat,
            cardId: topId,
          }),
      );
    }
  }

  // WHY: SP1 shuffle emits no event (no LibraryShuffled in the canonical
  // event set); the generator shape is preserved so PhaseHandler can drive
  // it uniformly via yield*. Shuffle is also NOT a replacement target: CR
  // 701.20 defines shuffling as a substep of other events, not an event
  // itself, so there's no intercept point here.
  // biome-ignore lint/correctness/useYield: emits no event kind
  *shuffle(seat: PlayerSeat): Generator<EngineYield, void, unknown> {
    const game = this.game;
    const player = game.getPlayer(seat);
    const library = player.zones.get(Zt.Library);
    if (!library) throw new GameStateIntegrityError(`Player ${seat} has no Library zone`);
    // WHY: Zone doesn't expose set(); we snapshot, clear, and re-add in the
    // shuffled order so the internal items array reflects the rng-driven
    // permutation deterministically.
    const current = library.toArray();
    const shuffled = game.rng.shuffle(current);
    library.clear();
    for (const id of shuffled) library.add(id);
  }

  // === SP2/SP3 stubs ===

  // WHY: SP2/SP3 stubs. The `function*` keyword alone makes these generators;
  // no yield statement is needed because execution throws before returning.
  // Callers must invoke .next() to trigger the throw (generators don't run
  // their body on construction). biome-ignore on each stub because
  // correctness/useYield doesn't account for always-throw bodies.

  // biome-ignore lint/correctness/useYield: stub throws before any yield
  *scry(_seat: PlayerSeat, _count: number): Generator<EngineYield, void, unknown> {
    throw new Error("GameAction.scry: yields decision — requires SP2 driver loop");
  }

  // biome-ignore lint/correctness/useYield: stub throws before any yield
  *surveil(_seat: PlayerSeat, _count: number): Generator<EngineYield, void, unknown> {
    throw new Error("GameAction.surveil: yields decision — requires SP2 driver loop");
  }

  // biome-ignore lint/correctness/useYield: stub throws before any yield
  *proliferate(_seat: PlayerSeat): Generator<EngineYield, void, unknown> {
    throw new Error("GameAction.proliferate: requires SP2 replacement/trigger routing");
  }

  // biome-ignore lint/correctness/useYield: stub throws before any yield
  *createToken(_params: unknown): Generator<EngineYield, void, unknown> {
    throw new Error("GameAction.createToken: SP2 token factory required");
  }

  // biome-ignore lint/correctness/useYield: stub throws before any yield
  *createEmblem(_params: unknown): Generator<EngineYield, void, unknown> {
    throw new Error("GameAction.createEmblem: SP2 emblem factory required");
  }

  // === Helpers ===

  private locate(cardId: EntityId): { fromZone: ZoneType; owner: PlayerSeat | null } {
    // WHY: Stack is deliberately omitted here. Stack items are rich
    // StackItem records (not EntityIds); moving a card OFF the stack happens
    // inside resolveStackItem (SP2+), which pops the StackItem and then
    // moves the underlying source card through its own path. Searching
    // Stack via Card EntityId would require a bespoke helper and is not
    // used by any SP1 callers.
    const game = this.game;
    if (game.sharedZones.exile.contains(cardId)) {
      return { fromZone: Zt.Exile, owner: null };
    }
    if (game.sharedZones.ante.contains(cardId)) {
      return { fromZone: Zt.Ante, owner: null };
    }
    for (const player of game.players) {
      for (const zone of player.zones.values()) {
        if (zone.contains(cardId)) {
          return { fromZone: zone.type, owner: player.seat };
        }
      }
    }
    throw new GameStateIntegrityError(`Card ${cardId} not found in any zone`);
  }

  private zoneFor(t: ZoneType, owner: PlayerSeat | null): Zone {
    const game = this.game;
    if (owner === null) {
      // WHY: Stack is not a Zone subclass; moving a card directly to the
      // stack isn't supported through moveTo — callers construct a
      // StackItem and use putOnStack() instead.
      if (t === Zt.Stack) {
        throw new GameStateIntegrityError("GameAction.moveTo: cannot move to Stack directly; use putOnStack");
      }
      if (t === Zt.Exile) return game.sharedZones.exile;
      if (t === Zt.Ante) return game.sharedZones.ante;
      throw new GameStateIntegrityError(`Zone ${t} requires an owner`);
    }
    const zone = game.getPlayer(owner).zones.get(t);
    if (!zone) throw new GameStateIntegrityError(`Player ${owner} has no zone ${t}`);
    return zone;
  }

  private defaultDestinationSeat(toZone: ZoneType, fromOwner: PlayerSeat | null): PlayerSeat | null {
    // WHY: shared zones (Exile, Ante, Stack) are unowned. Per-player zone
    // destinations default to the source card's current owner, matching the
    // most common "return to hand", "put into graveyard" effects. Effects
    // that move a card to another player's zone pass an explicit toSeat.
    if (toZone === Zt.Exile || toZone === Zt.Ante || toZone === Zt.Stack) return null;
    return fromOwner;
  }
}
