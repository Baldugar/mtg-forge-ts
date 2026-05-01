// SPDX-License-Identifier: GPL-3.0-or-later
// Wave 115 — player-counter MutationIntent layer.
//
// Card counters route through `MutationIntent` so doublers (Doubling Season
// etc.) can intercept on the `addCounter` parent. Player counters (poison
// from Infect, energy, experience, ticket, rad) historically bypassed this
// layer. Wave 115 introduces an `addPlayerCounter` MutationIntent kind +
// `GameAction.addPlayerCounter` mutator, and extends `AddCounterReplacement`
// to match BOTH parent halves (matching Vorinclex of the Hunger's printed
// "permanent or player" wording).
//
// Closes 1 of 4 remaining infra-blocked TODOs.
import type {
  EntityId,
  LobbyPlayer,
  MutationIntent,
  PaperCard,
  PlayerSeat,
  ReplacementAbility,
  StaticAbility,
  StaticAbilityMode,
  StaticAst,
} from "@mtg-forge-ts/core";
import {
  CounterType,
  DEFAULT_PAPER_CARD_FLAGS,
  SeededRng,
  ZoneType,
  mkEntityId,
  mkPlayerSeat,
} from "@mtg-forge-ts/core";
import { describe, expect, it } from "vitest";
import type { EngineYield } from "../action/engine-yield.js";
import { GameAction } from "../action/game-action.js";
import { Card } from "../card.js";
import type { GameMeta } from "../game-meta.js";
import type { GameRules } from "../game-rules.js";
import { Game } from "../game.js";
import { staticHandlerRegistry } from "../static/static-handler.js";
import { Battlefield } from "../zone/zones/battlefield.js";
import { Library } from "../zone/zones/library.js";
// Side-effect: register every static handler (so CantPutCounter resolves).
import "../static/handlers/index.js";

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
  cardDataSyncedAt: "2026-04-30T00:00:00Z",
  crVersion: "2024-11-08",
  seed: "wave115",
};
const paper: PaperCard = {
  name: "T",
  edition: "LEA",
  collectorNumber: "001",
  language: "en",
  foil: false,
  flags: DEFAULT_PAPER_CARD_FLAGS,
};

interface Fixture {
  readonly game: Game;
  readonly action: GameAction;
  readonly seat0: PlayerSeat;
  readonly seat1: PlayerSeat;
}

const mkFixture = (): Fixture => {
  const game = new Game({ lobbyPlayers: [alice, bob], rules, meta, rng: new SeededRng(1n) });
  for (const p of game.players) {
    p.zones.set(ZoneType.Library, new Library(ZoneType.Library, p.seat));
    p.zones.set(ZoneType.Battlefield, new Battlefield(ZoneType.Battlefield, p.seat));
  }
  return {
    game,
    action: new GameAction(game),
    seat0: mkPlayerSeat(0),
    seat1: mkPlayerSeat(1),
  };
};

const addCard = (game: Game, seat: PlayerSeat, id: EntityId): Card => {
  const card = new Card(id, paper, seat, seat, ZoneType.Battlefield);
  game.cards.set(id, card);
  game.getPlayer(seat).zones.get(ZoneType.Battlefield)?.add(id);
  return card;
};

const runAll = (gen: Generator<EngineYield, void, unknown>): EngineYield[] => {
  const out: EngineYield[] = [];
  let step = gen.next();
  while (!step.done) {
    const y = step.value;
    out.push(y);
    if (y.kind === "decision" && y.request.kind === "orderReplacements") {
      step = gen.next({ order: [...y.request.replacementIds] });
    } else {
      step = gen.next();
    }
  }
  return out;
};

const eventsOfKind = (ys: EngineYield[], kind: string): EngineYield[] =>
  ys.filter((y) => y.kind === "event" && y.event.kind === kind);

type Apply = (i: MutationIntent) => MutationIntent | null;
type Matches = (i: MutationIntent) => boolean;

const mkReplacement = (
  id: number,
  sourceCardId: number,
  apply: Apply,
  matches: Matches = () => true,
): ReplacementAbility => ({
  id: mkEntityId(id),
  kind: "replacement",
  sourceCardId: mkEntityId(sourceCardId),
  activeInZones: new Set([ZoneType.Battlefield]),
  timestamp: 1,
  controllerSeatAtReg: mkPlayerSeat(0),
  matches,
  apply: (i) => apply(i),
  isSelfReplacement: false,
  layer: "other",
});

const buildAndRegisterStatic = (
  game: Game,
  ast: StaticAst,
  sourceCardId: number,
  staticIdSeed: number,
  controllerSeat: 0 | 1 = 0,
): StaticAbility => {
  const Cls = staticHandlerRegistry.lookup(ast.mode as StaticAbilityMode);
  if (!Cls) throw new Error(`mode ${ast.mode} not registered`);
  const s = new Cls().build(ast, {
    game,
    sourceCardId: mkEntityId(sourceCardId),
    controllerSeat: mkPlayerSeat(controllerSeat),
    staticId: mkEntityId(staticIdSeed),
  });
  game.staticEffectRegistry.register(s);
  return s;
};

describe("Wave 115 — player-counter MutationIntent layer", () => {
  // ── 1. Poison counter add routes through intent ────────────────────────────
  it("addPlayerCounter (poison) routes through the replacement chain and emits PlayerCounterAdded", () => {
    const { action, game, seat0 } = mkFixture();
    addCard(game, seat0, mkEntityId(700));

    const intentsSeen: string[] = [];
    game.replacementRegistry.register(
      mkReplacement(
        1,
        999,
        (i) => {
          intentsSeen.push((i as { kind: string }).kind);
          return i;
        },
        (i) => (i as { kind: string }).kind === "addPlayerCounter",
      ),
    );

    const ys = runAll(action.addPlayerCounter(seat0, CounterType.Poison, 3));
    // Replacement saw the intent.
    expect(intentsSeen).toEqual(["addPlayerCounter"]);
    // Canonical event fired with the routed amount.
    const events = eventsOfKind(ys, "PlayerCounterAdded");
    expect(events).toHaveLength(1);
    if (events[0]?.kind !== "event") throw new Error("event");
    if (events[0].event.kind !== "PlayerCounterAdded") throw new Error("PlayerCounterAdded");
    expect(events[0].event.payload.counterType).toBe("poison");
    expect(events[0].event.payload.amount).toBe(3);
    // Counter actually landed on the canonical store.
    const player = game.getPlayer(seat0);
    expect(player.counters.get(CounterType.Poison)).toBe(3);
    // Legacy duck-typed slot mirrored.
    expect((player as { poisonCounters?: number }).poisonCounters).toBe(3);
    // ReplacementApplied emitted exactly once.
    expect(eventsOfKind(ys, "ReplacementApplied")).toHaveLength(1);
  });

  // ── 2. Energy counter add routes through intent ────────────────────────────
  it("addPlayerCounter (energy) routes through the chain; non-Poison counters skip the legacy slot", () => {
    const { action, game, seat0 } = mkFixture();

    const seenKinds: string[] = [];
    const seenCounterTypes: string[] = [];
    game.replacementRegistry.register(
      mkReplacement(
        2,
        998,
        (i) => {
          const ci = i as { kind: string; counterType: string };
          seenKinds.push(ci.kind);
          seenCounterTypes.push(String(ci.counterType));
          return i;
        },
        (i) => (i as { kind: string }).kind === "addPlayerCounter",
      ),
    );

    const ys = runAll(action.addPlayerCounter(seat0, CounterType.Energy, 5));
    expect(seenKinds).toEqual(["addPlayerCounter"]);
    expect(seenCounterTypes[0]).toBe(String(CounterType.Energy));
    const player = game.getPlayer(seat0);
    expect(player.counters.get(CounterType.Energy)).toBe(5);
    // Legacy poisonCounters slot must NOT be touched for non-Poison counters.
    expect((player as { poisonCounters?: number }).poisonCounters).toBeUndefined();
    const events = eventsOfKind(ys, "PlayerCounterAdded");
    expect(events).toHaveLength(1);
    if (events[0]?.kind !== "event") throw new Error("event");
    if (events[0].event.kind !== "PlayerCounterAdded") throw new Error("PlayerCounterAdded");
    expect(events[0].event.payload.counterType).toBe(String(CounterType.Energy));
    expect(events[0].event.payload.amount).toBe(5);
  });

  // ── 3. Doubling Season-shape doubler doubles player poison ────────────────
  it("Vorinclex-shape doubler doubles player poison counters via the addPlayerCounter parent", () => {
    const { action, game, seat0 } = mkFixture();

    // Doubling Season shape: any addCounter / addPlayerCounter intent has
    // its `amount` doubled. Mirrors how AddCounterReplacement's Amount$ 2
    // multiplier rewrites the in-flight intent.
    game.replacementRegistry.register(
      mkReplacement(
        3,
        997,
        (i) => {
          const src = i as unknown as { amount: number };
          return {
            ...(i as unknown as Record<string, unknown>),
            amount: src.amount * 2,
          } as unknown as MutationIntent;
        },
        (i) => (i as { kind: string }).kind === "addPlayerCounter",
      ),
    );

    const ys = runAll(action.addPlayerCounter(seat0, CounterType.Poison, 2));
    const player = game.getPlayer(seat0);
    // Doubled: 2 → 4.
    expect(player.counters.get(CounterType.Poison)).toBe(4);
    // Event payload reflects the doubled amount.
    const events = eventsOfKind(ys, "PlayerCounterAdded");
    if (events[0]?.kind !== "event") throw new Error("event");
    if (events[0].event.kind !== "PlayerCounterAdded") throw new Error("PlayerCounterAdded");
    expect(events[0].event.payload.amount).toBe(4);
    // Legacy mirror also reflects the doubled total.
    expect((player as { poisonCounters?: number }).poisonCounters).toBe(4);
  });

  // ── 4. Lifecycle: replacement chain consumed once per add ─────────────────
  it("two stacking doublers fire exactly once each per add (CR 614.5 one-apply rule)", () => {
    const { action, game, seat0 } = mkFixture();

    // Two independent +amount doublers (×2 each). Each must fire ONCE.
    let calls0 = 0;
    let calls1 = 0;
    const doubler =
      (counter: { n: number }) =>
      (i: MutationIntent): MutationIntent => {
        counter.n += 1;
        const src = i as unknown as { amount: number };
        return {
          ...(i as unknown as Record<string, unknown>),
          amount: src.amount * 2,
        } as unknown as MutationIntent;
      };
    game.replacementRegistry.register(
      mkReplacement(
        4,
        996,
        doubler({
          get n() {
            return calls0;
          },
          set n(v) {
            calls0 = v;
          },
        }),
        (i) => (i as { kind: string }).kind === "addPlayerCounter",
      ),
    );
    game.replacementRegistry.register(
      mkReplacement(
        5,
        995,
        doubler({
          get n() {
            return calls1;
          },
          set n(v) {
            calls1 = v;
          },
        }),
        (i) => (i as { kind: string }).kind === "addPlayerCounter",
      ),
    );

    const ys = runAll(action.addPlayerCounter(seat0, CounterType.Poison, 1));
    // Each replacement fired exactly once.
    expect(calls0).toBe(1);
    expect(calls1).toBe(1);
    // Final amount = 1 × 2 × 2 = 4.
    const player = game.getPlayer(seat0);
    expect(player.counters.get(CounterType.Poison)).toBe(4);
    // Two ReplacementApplied entries (one per fired replacement).
    expect(eventsOfKind(ys, "ReplacementApplied")).toHaveLength(2);
    // Single canonical event.
    expect(eventsOfKind(ys, "PlayerCounterAdded")).toHaveLength(1);
  });

  // ── 5. CantPutCounter on player still blocks (Wave 70.E gate) ─────────────
  it("CantPutCounter ValidPlayer$ You blocks the addPlayerCounter (Phyrexian Unlife shape)", () => {
    const { action, game, seat0 } = mkFixture();
    addCard(game, seat0, mkEntityId(800));

    // Phyrexian Unlife — "Counters can't be put on you."
    buildAndRegisterStatic(
      game,
      {
        mode: "CantPutCounter",
        params: {
          ValidPlayer: { kind: "literal", raw: "You" },
          CounterType: { kind: "literal", raw: "Poison" },
        },
        activeInZones: [],
      } as unknown as StaticAst,
      800,
      99800,
      0,
    );

    // Even with a doubling replacement in flight, the gate must short-circuit
    // BEFORE the intent enters the chain (no event, no replacement fires).
    let chainCalls = 0;
    game.replacementRegistry.register(
      mkReplacement(
        6,
        994,
        (i) => {
          chainCalls++;
          return i;
        },
        (i) => (i as { kind: string }).kind === "addPlayerCounter",
      ),
    );

    const ys = runAll(action.addPlayerCounter(seat0, CounterType.Poison, 5));
    // No counter landed.
    const player = game.getPlayer(seat0);
    expect(player.counters.get(CounterType.Poison) ?? 0).toBe(0);
    // No event fired (silent no-op, matching `addCounter`'s gate semantics).
    expect(eventsOfKind(ys, "PlayerCounterAdded")).toHaveLength(0);
    expect(eventsOfKind(ys, "ReplacementApplied")).toHaveLength(0);
    expect(eventsOfKind(ys, "EventPrevented")).toHaveLength(0);
    // Replacement chain never engaged.
    expect(chainCalls).toBe(0);

    // Opponent's poison still adds normally — gate is scoped to seat0.
    const ys2 = runAll(action.addPlayerCounter(mkPlayerSeat(1), CounterType.Poison, 2));
    const opp = game.getPlayer(mkPlayerSeat(1));
    expect(opp.counters.get(CounterType.Poison)).toBe(2);
    expect(eventsOfKind(ys2, "PlayerCounterAdded")).toHaveLength(1);
  });
});
