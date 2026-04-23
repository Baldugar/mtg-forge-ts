// SPDX-License-Identifier: GPL-3.0-or-later
// GameAction — generator-based mutation API over Game state. Every mutating
// operation is a generator function that:
//   1. mutates the relevant state (card zones, player life, counters, etc.),
//   2. yields an EngineYield per observable effect (events today, decisions
//      once SP2 adds triggered/replacement processing + driver loop).
//
// SP1 scope: emit the canonical GameEvent for each operation and update the
// minimum model state required by the event payload. SP2 layers
// replacement-effect routing, trigger harvesting, and state-based-action
// checking on top of these generators without changing their signatures.
// SP3 fills in costs (the `_cost` / `costPaid` slots currently `unknown`).
//
// Why generators: the driver needs to pause mid-mutation to ask controllers
// for decisions (choose order of replacements, scry order, blocker orders,
// etc.). Generators make the pause-and-resume contract explicit at the
// type-system level via the EngineYield union.
import type { CounterType, EntityId, PlayerSeat, ZoneType } from "@mtg-forge-ts/core";
import { GameStateIntegrityError, IllegalDecisionError, ZoneType as Zt, mkEvent } from "@mtg-forge-ts/core";
import type { Game } from "../game.js";
import type { StackItem } from "../stack/stack-item.js";
import type { Zone } from "../zone/zone.js";
import type { EngineYield } from "./engine-yield.js";

export class GameAction {
  constructor(private readonly game: Game) {}

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
    for (let i = 0; i < count; i++) {
      // WHY: Forge/Java convention — index 0 is the TOP of the library.
      // Draw consumes the front of the list; items.length-1 is the bottom.
      const topId = library.removeAt(0);
      // WHY: running out of library mid-draw is a state-based loss condition
      // (SP2). For SP1 we simply stop drawing — the caller can detect this
      // via Library.size beforehand. Emitting CardDrawn with no card would
      // violate the event contract.
      if (topId === undefined) return;
      hand.add(topId);
      const card = game.cards.get(topId);
      if (card) card.zone = Zt.Hand;
      yield {
        kind: "event",
        event: mkEvent("CardDrawn", game.turn, game.phase, { playerSeat: seat, cardId: topId }),
      };
    }
  }

  *changeLife(
    seat: PlayerSeat,
    delta: number,
    opts?: { readonly cause?: string },
  ): Generator<EngineYield, void, unknown> {
    const game = this.game;
    const player = game.getPlayer(seat);
    const oldLife = player.life;
    const newLife = oldLife + delta;
    player.life = newLife;
    yield {
      kind: "event",
      event: mkEvent("LifeChanged", game.turn, game.phase, {
        playerSeat: seat,
        oldLife,
        newLife,
        delta,
        cause: opts?.cause ?? "effect",
      }),
    };
  }

  *moveTo(
    cardId: EntityId,
    toZone: ZoneType,
    opts?: { readonly toSeat?: PlayerSeat; readonly cause?: string },
  ): Generator<EngineYield, void, unknown> {
    const game = this.game;
    const { fromZone, owner } = this.locate(cardId);
    const from = this.zoneFor(fromZone, owner);
    const toSeat = opts?.toSeat ?? this.defaultDestinationSeat(toZone, owner);
    const to = this.zoneFor(toZone, toSeat);
    from.remove(cardId);
    to.add(cardId);
    const card = game.cards.get(cardId);
    if (card) {
      card.zone = toZone;
      if (toSeat !== null) card.controllerSeat = toSeat;
    }
    // CR 613.1 — zone change alters which continuous effects apply (layered
    // values are defined only for permanents on the battlefield, etc.);
    // invalidate the cache so the next characteristics read re-derives from
    // the new zone.
    game.layerEngine.bumpEpoch("moveTo");
    yield {
      kind: "event",
      event: mkEvent("CardChangedZone", game.turn, game.phase, {
        cardId,
        fromZone,
        toZone,
        ...(owner !== null ? { fromSeat: owner } : {}),
        ...(toSeat !== null ? { toSeat } : {}),
        ...(opts?.cause !== undefined ? { cause: opts.cause } : {}),
      }),
    };
  }

  // === Tap/untap (SP1 event-only, SP2 expands with intervening-if etc) ===

  *tap(cardId: EntityId): Generator<EngineYield, void, unknown> {
    const card = this.game.cards.get(cardId);
    // WHY: idempotent on no state change. SP2 trigger handlers listening
    // on CardTapped would fire on redundant tap() calls if we always
    // emitted — matching Forge semantics, an already-tapped permanent
    // doesn't re-trigger. Missing-card case stays a silent no-op to
    // match the original defensive behavior.
    if (!card || card.tapped) return;
    card.tapped = true;
    // Tapped-state can gate continuous effects (e.g. "as long as CARDNAME is
    // tapped"). Bump only on actual state transition so idempotent no-op
    // taps don't churn the cache.
    this.game.layerEngine.bumpEpoch("tap");
    yield {
      kind: "event",
      event: mkEvent("CardTapped", this.game.turn, this.game.phase, { cardId }),
    };
  }

  *untap(cardId: EntityId): Generator<EngineYield, void, unknown> {
    const card = this.game.cards.get(cardId);
    if (!card || !card.tapped) return;
    card.tapped = false;
    // Symmetric with tap: only bump on actual state transition.
    this.game.layerEngine.bumpEpoch("untap");
    yield {
      kind: "event",
      event: mkEvent("CardUntapped", this.game.turn, this.game.phase, { cardId }),
    };
  }

  // === Destroy / exile / sacrifice — event + zone change via moveTo ===

  *destroy(
    cardId: EntityId,
    opts?: { readonly sourceId?: EntityId; readonly cause?: "damage" | "sba" | "effect" },
  ): Generator<EngineYield, void, unknown> {
    const game = this.game;
    yield {
      kind: "event",
      event: mkEvent("CardDestroyed", game.turn, game.phase, {
        cardId,
        ...(opts?.sourceId !== undefined ? { sourceId: opts.sourceId } : {}),
        cause: opts?.cause ?? "effect",
      }),
    };
    yield* this.moveTo(cardId, Zt.Graveyard);
  }

  *exile(cardId: EntityId, opts?: { readonly sourceId?: EntityId }): Generator<EngineYield, void, unknown> {
    const game = this.game;
    const { fromZone } = this.locate(cardId);
    yield {
      kind: "event",
      event: mkEvent("CardExiled", game.turn, game.phase, {
        cardId,
        fromZone,
        ...(opts?.sourceId !== undefined ? { sourceId: opts.sourceId } : {}),
      }),
    };
    yield* this.moveTo(cardId, Zt.Exile);
  }

  *sacrifice(
    cardId: EntityId,
    opts?: { readonly sourceId?: EntityId },
  ): Generator<EngineYield, void, unknown> {
    const game = this.game;
    const { owner } = this.locate(cardId);
    if (owner === null) {
      throw new GameStateIntegrityError(`Cannot sacrifice ${cardId} — not owned by any player`);
    }
    yield {
      kind: "event",
      event: mkEvent("CardSacrificed", game.turn, game.phase, {
        cardId,
        playerSeat: owner,
        ...(opts?.sourceId !== undefined ? { sourceId: opts.sourceId } : {}),
      }),
    };
    yield* this.moveTo(cardId, Zt.Graveyard);
  }

  // === Damage (SP1 event emission only) ===

  *damage(
    sourceId: EntityId,
    targetKind: "creature" | "player" | "planeswalker" | "battle",
    targetId: EntityId | PlayerSeat,
    amount: number,
    isCombat: boolean,
  ): Generator<EngineYield, void, unknown> {
    const game = this.game;
    // WHY: damage to a creature updates Card.damage; damage to a player
    // updates Player.life via a follow-up LifeChanged. SP1 keeps this
    // minimal — the damage marker is applied; life deduction is a
    // state-based-action step that SP2 will emit.
    if (targetKind === "creature" && typeof targetId === "number") {
      const card = game.cards.get(targetId as EntityId);
      if (card) card.damage += amount;
    }
    yield {
      kind: "event",
      event: mkEvent("DamageDealt", game.turn, game.phase, {
        sourceId,
        targetKind,
        targetId,
        amount,
        isCombat,
      }),
    };
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
    const card = game.cards.get(cardId);
    if (card) {
      const current = card.counters.get(counterType) ?? 0;
      card.counters.set(counterType, current + amount);
    }
    // Counters feed Layer 7d (P/T) and can gate other continuous effects
    // (e.g. "as long as CARDNAME has a +1/+1 counter on it"). Always bump
    // when the mutation ran — amount is validated > 0 above, so any non-
    // missing card observed a real state change.
    game.layerEngine.bumpEpoch("counter");
    yield {
      kind: "event",
      event: mkEvent("CounterAdded", game.turn, game.phase, {
        cardId,
        counterType,
        amount,
        ...(sourceId !== undefined ? { sourceId } : {}),
      }),
    };
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
    // an observable change to trigger/event subscribers.
    if (!card || !card.counters.has(counterType)) {
      return;
    }
    const current = card.counters.get(counterType) ?? 0;
    const next = Math.max(0, current - amount);
    if (next === 0) card.counters.delete(counterType);
    else card.counters.set(counterType, next);
    // Counter change → bump. The early returns above ensure we only reach
    // here on an observable state mutation; no-op removals do not bump.
    game.layerEngine.bumpEpoch("counter");
    yield {
      kind: "event",
      event: mkEvent("CounterRemoved", game.turn, game.phase, {
        cardId,
        counterType,
        amount,
        ...(sourceId !== undefined ? { sourceId } : {}),
      }),
    };
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
    if (card) card.controllerSeat = newController;
    if (oldController === undefined) {
      throw new GameStateIntegrityError(`changeControl: card ${cardId} not tracked`);
    }
    // CR 613.1b — control change invalidates the LayerEngine cache because
    // layered values scoped by controller (e.g., ability-grant statics) must
    // re-evaluate. Bump before the event emit so observers reading
    // characteristics during the event see the post-control-change view.
    game.layerEngine.bumpEpoch("control-change");
    yield {
      kind: "event",
      event: mkEvent("ControlChanged", game.turn, game.phase, {
        cardId,
        oldController,
        newController,
        ...(sourceId !== undefined ? { sourceId } : {}),
      }),
    };
  }

  // === Stack push ===

  *putOnStack(item: StackItem): Generator<EngineYield, void, unknown> {
    const game = this.game;
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
    for (let i = 0; i < count; i++) {
      // WHY: mill removes from the TOP of the library (index 0), matching
      // Forge and CR 701.13a ("put the top N cards... into graveyard").
      const topId = library.removeAt(0);
      if (topId === undefined) return;
      const graveyard = player.zones.get(Zt.Graveyard);
      if (!graveyard) {
        throw new GameStateIntegrityError(`Player ${seat} has no Graveyard zone`);
      }
      graveyard.add(topId);
      const card = game.cards.get(topId);
      if (card) card.zone = Zt.Graveyard;
      yield {
        kind: "event",
        event: mkEvent("CardMilled", game.turn, game.phase, { playerSeat: seat, cardId: topId }),
      };
    }
  }

  // WHY: SP1 shuffle emits no event (no LibraryShuffled in the canonical
  // event set); the generator shape is preserved so PhaseHandler can drive
  // it uniformly via yield*.
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
