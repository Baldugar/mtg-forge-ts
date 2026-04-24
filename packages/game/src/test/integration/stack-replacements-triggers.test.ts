// SPDX-License-Identifier: GPL-3.0-or-later
// SP2 Milestone X / Task 77 — cross-subsystem integration test driving the
// stack + replacement + trigger pipeline end-to-end:
//   - a replacement "prevent the next 3 damage that would be dealt to you
//     this turn" registered against a DamageIntent targeting seat 1 (CR
//     614 / 615);
//   - a cast-trigger "whenever you cast a spell, draw a card" registered
//     against SpellCast events (CR 603.1);
//   - priority-window draining: SBAs → triggers → expired effects →
//     priority decision (CR 117.1);
//   - stack-item resolution drawing a card (CR 608) via the SP2 Task 67
//     resolver hook;
//   - second copy of the damage intent passes cleanly because the
//     one-apply-once replacement (CR 614.5) has already unregistered
//     itself after the first apply.
//
// We do NOT drive the full CastPipeline here — SP2's cast pipeline does
// not yet emit a SpellCast event (SP3 wiring). The scenario synthesises a
// canonical SpellCast via game.emitEvent so the trigger registry, the
// priority orchestrator, and the resolve path are exercised against real
// code. Replacement-chain routing is exercised via the actual GameAction.
// damage mutator.
import type {
  DecisionResponse,
  EntityId,
  GameEvent,
  LobbyPlayer,
  MutationIntent,
  PaperCard,
  PlayerSeat,
  ReplacementAbility,
  TriggeredAbility,
} from "@mtg-forge-ts/core";
import {
  DEFAULT_PAPER_CARD_FLAGS,
  SeededRng,
  ZoneType,
  mkEntityId,
  mkEvent,
  mkPlayerSeat,
} from "@mtg-forge-ts/core";
import { describe, expect, it } from "vitest";
import type { EngineYield } from "../../action/engine-yield.js";
import { Card } from "../../card.js";
import type { GameMeta } from "../../game-meta.js";
import type { GameRules } from "../../game-rules.js";
import { Game } from "../../game.js";
import { runPriorityWindow } from "../../priority/priority-orchestrator.js";
import { resolveStackItem } from "../../resolve/effect-resolve.js";
import type { StackItem, StackItemResolver } from "../../stack/stack-item.js";
import { Battlefield } from "../../zone/zones/battlefield.js";
import { Graveyard } from "../../zone/zones/graveyard.js";
import { Hand } from "../../zone/zones/hand.js";
import { Library } from "../../zone/zones/library.js";

const alice: LobbyPlayer = { id: "p-alice", name: "Alice", controllerKind: "human" };
const bob: LobbyPlayer = { id: "p-bob", name: "Bob", controllerKind: "ai" };

const rules: GameRules = {
  formatId: "standard",
  startingLife: 20,
  startingHandSize: 7,
  mulliganRule: "london",
  firstPlayerSkipsDraw: true,
  ruleOverrides: [],
  playerCount: { min: 2, max: 2 },
  poisonCountersToLose: 10,
  playForAnte: false,
  manaBurn: false,
  appliedVariants: [],
};

const meta: GameMeta = {
  engineVersion: "0.0.0",
  forgeSha: "abc",
  cardDataSyncedAt: "2026-04-23T00:00:00Z",
  crVersion: "2024-11-08",
  seed: "01",
};

const paper: PaperCard = {
  name: "T",
  edition: "LEA",
  collectorNumber: "001",
  language: "en",
  foil: false,
  flags: DEFAULT_PAPER_CARD_FLAGS,
};

const seedZones = (game: Game): void => {
  for (const player of game.players) {
    player.zones.set(ZoneType.Library, new Library(ZoneType.Library, player.seat));
    player.zones.set(ZoneType.Hand, new Hand(ZoneType.Hand, player.seat));
    player.zones.set(ZoneType.Graveyard, new Graveyard(ZoneType.Graveyard, player.seat));
    player.zones.set(ZoneType.Battlefield, new Battlefield(ZoneType.Battlefield, player.seat));
  }
};

const addCard = (game: Game, seat: PlayerSeat, zone: ZoneType, id: EntityId): Card => {
  const card = new Card(id, paper, seat, seat, zone);
  game.cards.set(id, card);
  const z = game.getPlayer(seat).zones.get(zone);
  if (!z) throw new Error("test: missing zone");
  z.add(id);
  return card;
};

const mkGame = (): Game => {
  const game = new Game({ lobbyPlayers: [alice, bob], rules, meta, rng: new SeededRng(1n) });
  seedZones(game);
  return game;
};

// --- Drive helpers (generator bridges) -----------------------------------

/**
 * Drain any generator of EngineYield. Auto-accept orderReplacements
 * decisions by echoing the suggested order. Priority / resolve-time
 * decisions should not appear inside GameAction.damage or resolveStackItem
 * paths used here; they fail loud to catch future wiring drift.
 */
const drain = (gen: Generator<EngineYield, void, unknown>): EngineYield[] => {
  const out: EngineYield[] = [];
  let step = gen.next();
  while (!step.done) {
    const y = step.value;
    out.push(y);
    if (y.kind === "decision") {
      if (y.request.kind === "orderReplacements") {
        step = gen.next({ order: [...y.request.replacementIds] });
        continue;
      }
      throw new Error(`unexpected decision: ${y.request.kind}`);
    }
    step = gen.next();
  }
  return out;
};

/**
 * Drive runPriorityWindow to completion with a single `pass` response to
 * the final priority decision. Yields are collected for assertion; the
 * final PriorityResponse is returned for the caller (e.g. to verify
 * `pass`).
 */
interface PriorityDriveResult {
  readonly yields: readonly EngineYield[];
  readonly action: { readonly kind: string } | undefined;
}

const drivePriority = (game: Game): PriorityDriveResult => {
  const gen = runPriorityWindow(game);
  const yields: EngineYield[] = [];
  let step = gen.next();
  while (!step.done) {
    const y = step.value;
    yields.push(y);
    if (y.kind === "decision") {
      if (y.request.kind === "priority") {
        const response: DecisionResponse = { kind: "priority", action: { kind: "pass" } };
        step = gen.next(response);
        continue;
      }
      if (y.request.kind === "orderReplacements") {
        step = gen.next({ order: [...y.request.replacementIds] });
        continue;
      }
      throw new Error(`unexpected decision: ${y.request.kind}`);
    }
    step = gen.next();
  }
  return {
    yields,
    action:
      step.value !== undefined
        ? { kind: (step.value as { action: { kind: string } }).action.kind }
        : undefined,
  };
};

// --- Builders ------------------------------------------------------------

/**
 * One-apply-once damage-prevention replacement. Matches ONLY the first
 * DamageIntent whose target is a given seat; after firing, the replacement
 * unregisters itself so the second bolt falls through to normal resolution
 * (models "prevent the next N damage" with N=3 where a single 3-damage
 * event consumes the full shield).
 */
const mkPreventNextDamageToSeat = (
  game: Game,
  replacementId: number,
  targetSeat: PlayerSeat,
): ReplacementAbility => {
  const id = mkEntityId(replacementId);
  let spent = false;
  const repl: ReplacementAbility = {
    id,
    kind: "replacement",
    sourceCardId: mkEntityId(900 + replacementId),
    activeInZones: new Set([ZoneType.Battlefield]),
    timestamp: 1,
    controllerSeatAtReg: targetSeat,
    matches: (intent: MutationIntent): boolean => {
      if (spent) return false;
      if (intent.kind !== "damage") return false;
      const d = intent as unknown as {
        readonly targetKind: string;
        readonly targetId: unknown;
        readonly amount: number;
      };
      return d.targetKind === "player" && d.targetId === targetSeat && d.amount > 0;
    },
    apply: (_intent: MutationIntent): MutationIntent | null => {
      // Mark spent BEFORE returning null so even if the caller were to re-
      // query matches (it doesn't), the replacement would correctly report
      // inactive. Eagerly unregister from the registry too so snapshot /
      // audit reads see the shield consumed.
      spent = true;
      game.replacementRegistry.unregister(id);
      return null;
    },
    isSelfReplacement: false,
  };
  return repl;
};

interface CastSpellTriggerHandle {
  readonly trigger: TriggeredAbility;
  readonly resolverFactory: () => StackItemResolver;
}

/**
 * Cast-trigger "whenever you (controller) cast a spell, draw a card".
 * Matches SpellCast events whose controllerSeat equals the trigger's
 * controller-at-registration. The returned resolverFactory builds a
 * StackItemResolver that draws a card for the controller; the priority
 * orchestrator pushes a triggeredAbility StackItem with `resolver:
 * factory()` when the trigger fires — SP2 does NOT do this wiring
 * automatically (SP3 resolve-time-body landing), so the test binds the
 * resolver onto the pushed stack item before resolution.
 */
const mkDrawOnCastTrigger = (
  opts: {
    readonly id: number;
    readonly sourceCardId: EntityId;
    readonly controllerSeat: PlayerSeat;
  },
  drawResolver: () => StackItemResolver,
): CastSpellTriggerHandle => ({
  trigger: {
    id: mkEntityId(opts.id),
    kind: "triggered",
    sourceCardId: opts.sourceCardId,
    activeInZones: new Set([ZoneType.Battlefield]),
    timestamp: 1,
    controllerSeatAtReg: opts.controllerSeat,
    isDelayed: false,
    matches: (event: GameEvent): boolean =>
      event.kind === "SpellCast" && event.payload.controllerSeat === opts.controllerSeat,
  },
  resolverFactory: drawResolver,
});

// --- Tests ---------------------------------------------------------------

const eventsOfKind = (ys: readonly EngineYield[], kind: string): EngineYield[] =>
  ys.filter((y) => y.kind === "event" && y.event.kind === kind);

describe("SP2 Milestone X — stack + replacements + triggers end-to-end (Task 77)", () => {
  it("first bolt prevented; cast-trigger draws a card; second bolt deals 3", () => {
    const game = mkGame();
    const seatA = mkPlayerSeat(0);
    const seatB = mkPlayerSeat(1);

    // Seed seat A's library with two cards so the cast-trigger's draw
    // resolves against a non-empty library (drawCards returns silently on
    // an empty library per SP2's current contract; we want to observe a
    // hand-size +1 delta).
    const libCard1 = mkEntityId(1001);
    const libCard2 = mkEntityId(1002);
    addCard(game, seatA, ZoneType.Library, libCard1);
    addCard(game, seatA, ZoneType.Library, libCard2);

    // Seed the Lightning Bolts in seat A's hand. SP2 doesn't drive them
    // through CastPipeline here (see file header), so we hand-build a
    // StackItem and push it directly before emitting SpellCast.
    const bolt1 = mkEntityId(2001);
    const bolt2 = mkEntityId(2002);
    addCard(game, seatA, ZoneType.Hand, bolt1);
    addCard(game, seatA, ZoneType.Hand, bolt2);

    // Prevention: "the next instance of damage to seat B is prevented".
    const prevention = mkPreventNextDamageToSeat(game, 1, seatB);
    game.replacementRegistry.register(prevention);

    // Cast-trigger: "whenever seat A casts a spell, draw a card".
    const cmdSource = mkEntityId(3001);
    addCard(game, seatA, ZoneType.Battlefield, cmdSource);
    const handle = mkDrawOnCastTrigger({ id: 4001, sourceCardId: cmdSource, controllerSeat: seatA }, () => ({
      *resolve(g: unknown) {
        const innerGame = g as Game;
        yield* innerGame.action.drawCards(seatA, 1);
      },
    }));
    game.triggerRegistry.register(handle.trigger);

    // ---------- Cast #1: emit SpellCast, push Bolt1 on stack ------------
    const bolt1Resolver: StackItemResolver = {
      *resolve(g: unknown) {
        const innerGame = g as Game;
        yield* innerGame.action.damage(bolt1, "player", seatB, 3, false);
      },
    };
    const bolt1Stack: StackItem = {
      id: game.newEntityId(),
      sourceCardId: bolt1,
      controllerSeat: seatA,
      kind: "spell",
      isCast: true,
      targets: null,
      modes: [],
      xValue: null,
      costPaid: null,
      provenance: {
        originZone: ZoneType.Hand,
        altCostUsed: null,
        additionalCostsPaid: [],
      },
      resolver: bolt1Resolver,
    };
    game.sharedZones.stack.push(bolt1Stack);
    // Canonical SpellCast — routes through Game.emitEvent → TriggerRegistry
    // so the cast-trigger's pending queue picks it up.
    game.emitEvent(
      mkEvent("SpellCast", game.turn, game.phase, {
        stackItemId: bolt1Stack.id,
        cardId: bolt1,
        controllerSeat: seatA,
      }),
    );

    // Priority window drains the pending cast-trigger onto the stack. The
    // trigger registry's default pushed item has resolver=undefined; SP2's
    // runPriorityWindow doesn't know about our custom draw resolver, so we
    // patch it onto the pushed stack item after the drain (mirror of SP3
    // work). Run the window, find the triggered-ability item, inject the
    // draw resolver.
    const priority1 = drivePriority(game);
    const triggerQueued = eventsOfKind(priority1.yields, "TriggerQueued");
    expect(triggerQueued).toHaveLength(1);
    const stackSnapshot = game.sharedZones.stack.toArray();
    // Stack from bottom up: [bolt1, drawCardTrigger]. The trigger is on
    // top; it resolves first.
    expect(stackSnapshot).toHaveLength(2);
    const top = stackSnapshot[stackSnapshot.length - 1];
    if (top === undefined) throw new Error("test: empty stack snapshot");
    expect(top.kind).toBe("triggeredAbility");
    expect(top.triggerId).toBe(handle.trigger.id);

    // Patch the draw resolver onto the triggered StackItem.
    const topWithResolver: StackItem = { ...top, resolver: handle.resolverFactory() };
    // WHY: the Stack API has no in-place replace; pop + push preserves
    // ordering as long as nothing else has pushed since we peeked (nothing
    // has — priority window returned, then we immediately read + patched).
    game.sharedZones.stack.pop();
    game.sharedZones.stack.push(topWithResolver);

    // ---------- Resolve the draw trigger ---------------------------------
    const handBefore = game.getPlayer(seatA).zones.get(ZoneType.Hand)?.size ?? 0;
    const drawResolveYields = drain(resolveStackItem(game, topWithResolver));
    // Pop the triggered-ability slot (resolveStackItem does not auto-pop).
    const popped = game.sharedZones.stack.pop();
    expect(popped?.id).toBe(topWithResolver.id);

    // Trigger resolution drew one card for seat A.
    const drew = eventsOfKind(drawResolveYields, "CardDrawn");
    expect(drew).toHaveLength(1);
    const handAfterDraw = game.getPlayer(seatA).zones.get(ZoneType.Hand)?.size ?? 0;
    expect(handAfterDraw).toBe(handBefore + 1);

    // ---------- Resolve Bolt #1 (prevention kicks in) --------------------
    const stackAfterDraw = game.sharedZones.stack.toArray();
    expect(stackAfterDraw).toHaveLength(1);
    expect(stackAfterDraw[0]?.id).toBe(bolt1Stack.id);
    const seatBLifeBefore = game.getPlayer(seatB).life;

    const bolt1ResolveYields = drain(resolveStackItem(game, bolt1Stack));
    // Pop + source-movement is handled inside resolveStackItem for spells —
    // the spell card moves to graveyard, but the StackItem itself must
    // still be popped by the caller (the resolver does not re-pop the
    // stack top).
    game.sharedZones.stack.pop();

    // Assertions on replacement + prevention event sequence.
    expect(eventsOfKind(bolt1ResolveYields, "ReplacementApplied")).toHaveLength(1);
    expect(eventsOfKind(bolt1ResolveYields, "EventPrevented")).toHaveLength(1);
    expect(eventsOfKind(bolt1ResolveYields, "DamageDealt")).toHaveLength(0);
    expect(game.getPlayer(seatB).life).toBe(seatBLifeBefore);
    // Bolt1's source card moved to graveyard on resolution.
    expect(game.cards.get(bolt1)?.zone).toBe(ZoneType.Graveyard);
    // Prevention replacement is consumed (unregistered).
    expect(game.replacementRegistry.byCard(mkEntityId(901))).toHaveLength(0);

    // ---------- Cast #2: identical flow; this time damage lands ----------
    const bolt2Resolver: StackItemResolver = {
      *resolve(g: unknown) {
        const innerGame = g as Game;
        yield* innerGame.action.damage(bolt2, "player", seatB, 3, false);
      },
    };
    const bolt2Stack: StackItem = {
      id: game.newEntityId(),
      sourceCardId: bolt2,
      controllerSeat: seatA,
      kind: "spell",
      isCast: true,
      targets: null,
      modes: [],
      xValue: null,
      costPaid: null,
      provenance: {
        originZone: ZoneType.Hand,
        altCostUsed: null,
        additionalCostsPaid: [],
      },
      resolver: bolt2Resolver,
    };
    game.sharedZones.stack.push(bolt2Stack);
    game.emitEvent(
      mkEvent("SpellCast", game.turn, game.phase, {
        stackItemId: bolt2Stack.id,
        cardId: bolt2,
        controllerSeat: seatA,
      }),
    );

    // Cast-trigger fires again — same patch dance.
    const priority2 = drivePriority(game);
    expect(eventsOfKind(priority2.yields, "TriggerQueued")).toHaveLength(1);
    const top2 = game.sharedZones.stack.top();
    if (top2 === undefined) throw new Error("test: empty stack after second cast");
    expect(top2.kind).toBe("triggeredAbility");
    const top2WithResolver: StackItem = { ...top2, resolver: handle.resolverFactory() };
    game.sharedZones.stack.pop();
    game.sharedZones.stack.push(top2WithResolver);

    const handBefore2 = game.getPlayer(seatA).zones.get(ZoneType.Hand)?.size ?? 0;
    drain(resolveStackItem(game, top2WithResolver));
    game.sharedZones.stack.pop();
    expect(game.getPlayer(seatA).zones.get(ZoneType.Hand)?.size).toBe(handBefore2 + 1);

    // Bolt2 resolves with no prevention (replacement was consumed). The
    // DamageDealt event fires; Player.life is not inline-updated (see SP2
    // note in full-combat-scenario.test.ts — life change on player damage
    // is SP3 wiring).
    const bolt2ResolveYields = drain(resolveStackItem(game, bolt2Stack));
    game.sharedZones.stack.pop();
    const damageDealt = eventsOfKind(bolt2ResolveYields, "DamageDealt");
    expect(damageDealt).toHaveLength(1);
    if (damageDealt[0]?.kind !== "event") throw new Error("DamageDealt event expected");
    if (damageDealt[0].event.kind !== "DamageDealt") throw new Error("DamageDealt kind expected");
    expect(damageDealt[0].event.payload.amount).toBe(3);
    expect(damageDealt[0].event.payload.targetKind).toBe("player");
    expect(damageDealt[0].event.payload.targetId).toBe(seatB);
    expect(eventsOfKind(bolt2ResolveYields, "EventPrevented")).toHaveLength(0);
    expect(eventsOfKind(bolt2ResolveYields, "ReplacementApplied")).toHaveLength(0);

    // After both bolts + two draws, stack is empty.
    expect(game.sharedZones.stack.isEmpty()).toBe(true);
  });

  it("replacement never consumes a non-matching intent; unrelated damage flows through", () => {
    // Sibling assertion on the one-apply + gate semantics: a prevention
    // shield for seat 1 must NOT fire on damage routed to seat 0, and the
    // shield stays armed for its real target.
    const game = mkGame();
    const seatA = mkPlayerSeat(0);
    const seatB = mkPlayerSeat(1);
    const prevention = mkPreventNextDamageToSeat(game, 10, seatB);
    game.replacementRegistry.register(prevention);

    // Damage to seat A — should flow through, shield still armed.
    const source = mkEntityId(7001);
    drain(game.action.damage(source, "player", seatA, 2, false));
    expect(game.replacementRegistry.all()).toHaveLength(1);

    // Damage to seat B — shield fires, unregisters.
    const ys = drain(game.action.damage(source, "player", seatB, 4, false));
    expect(eventsOfKind(ys, "EventPrevented")).toHaveLength(1);
    expect(eventsOfKind(ys, "DamageDealt")).toHaveLength(0);
    expect(game.replacementRegistry.all()).toHaveLength(0);

    // Second hit on seat B — no shield, damage flows.
    const ys2 = drain(game.action.damage(source, "player", seatB, 1, false));
    expect(eventsOfKind(ys2, "EventPrevented")).toHaveLength(0);
    expect(eventsOfKind(ys2, "DamageDealt")).toHaveLength(1);
  });
});
