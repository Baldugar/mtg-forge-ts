import { parseCard } from "@mtg-forge-ts/cards";
// SPDX-License-Identifier: GPL-3.0-or-later
// Task 62 — Healing Salve flagship integration test.
// Exercises the complete parse → build → cast → pay → resolve pipeline:
//   1. Parse Healing Salve source text into a CardDefinition.
//   2. Construct a Card in the casting player's hand and call
//      activateAbilitiesFromDefinition().
//   3. Seed 1 W in the casting player's mana pool.
//   4. Run CastPipeline (steps 1-10).
//   5. Resolve the stack item via resolveStackItem (GainLife targets controller).
//   6. Assert: controller life 20 → 23, pool empty, Salve in graveyard.
import type { EntityId, LobbyPlayer, PaperCard, PlayerSeat } from "@mtg-forge-ts/core";
import {
  Color,
  DEFAULT_PAPER_CARD_FLAGS,
  ManaProduced,
  SeededRng,
  ZoneType,
  mkEntityId,
  mkPlayerSeat,
} from "@mtg-forge-ts/core";
import { describe, expect, it } from "vitest";
import { Card } from "../../src/card.js";
import type { CastProposal } from "../../src/cast/cast-pipeline.js";
import type { GameMeta } from "../../src/game-meta.js";
import type { GameRules } from "../../src/game-rules.js";
import { Game } from "../../src/game.js";
import { ManaPool } from "../../src/mana/mana-pool.js";
import { resolveStackItem } from "../../src/resolve/effect-resolve.js";
import type { StackItem } from "../../src/stack/stack-item.js";
import { Battlefield } from "../../src/zone/zones/battlefield.js";
import { Graveyard } from "../../src/zone/zones/graveyard.js";
import { Hand } from "../../src/zone/zones/hand.js";
import { Library } from "../../src/zone/zones/library.js";

// Self-register all M7 effects into the effectRegistry
import "../../src/ability/effects/index.js";
// Register cost parts into costPartRegistry
import "../../src/cost/parts/index.js";
// SVar number selectors
import "../../src/svar/selectors/number.js";

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

const salveSrc = `${[
  "Name:Healing Salve",
  "ManaCost:W",
  "Types:Instant",
  "A:SP$ GainLife | Cost$ W | LifeAmount$ 3",
  "Oracle:Target player gains 3 life.",
].join("\n")}\n`;

const makeGame = () => {
  const game = new Game({ lobbyPlayers: [alice, bob], rules, meta, rng: new SeededRng(1n) });
  for (const player of game.players) {
    player.zones.set(ZoneType.Library, new Library(ZoneType.Library, player.seat));
    player.zones.set(ZoneType.Hand, new Hand(ZoneType.Hand, player.seat));
    player.zones.set(ZoneType.Graveyard, new Graveyard(ZoneType.Graveyard, player.seat));
    player.zones.set(ZoneType.Battlefield, new Battlefield(ZoneType.Battlefield, player.seat));
  }
  return game;
};

const addCardToHand = (game: Game, paper: PaperCard, seat: PlayerSeat, id: EntityId): Card => {
  const card = new Card(id, paper, seat, seat, ZoneType.Hand);
  game.cards.set(id, card);
  const hand = game.getPlayer(seat).zones.get(ZoneType.Hand);
  if (!hand) throw new Error("test: missing hand zone");
  hand.add(id);
  return card;
};

/**
 * Drive the cast generator. Responds to activateManaAbilities with done:true.
 * Returns the finalized StackItem (or null on abort) plus all event kinds.
 */
const drainCast = (
  gen: Generator<{ kind: string }, StackItem | null, unknown>,
): { events: string[]; result: StackItem | null } => {
  const events: string[] = [];
  let step = gen.next();
  while (!step.done) {
    const y = step.value as { kind: string; event?: { kind?: string }; request?: { kind?: string } };
    if (y.kind === "event" && y.event?.kind) {
      events.push(y.event.kind);
      step = gen.next();
    } else if (y.kind === "decision" && y.request?.kind === "activateManaAbilities") {
      step = gen.next({ kind: "activateManaAbilities", done: true });
    } else {
      step = gen.next();
    }
  }
  return { events, result: step.value };
};

/**
 * Drain a resolver generator. Auto-responds to orderReplacements decisions
 * by echoing the provided order.
 */
const drainResolver = (gen: Generator<unknown, void, unknown>): string[] => {
  const events: string[] = [];
  let step = gen.next();
  while (!step.done) {
    const y = step.value as {
      kind?: string;
      event?: { kind?: string };
      request?: { kind?: string; replacementIds?: number[] };
    };
    if (y.kind === "event" && y.event?.kind) {
      events.push(y.event.kind);
      step = gen.next();
    } else if (y.kind === "decision" && y.request?.kind === "orderReplacements") {
      step = gen.next({ order: [...(y.request.replacementIds ?? [])] });
    } else {
      step = gen.next();
    }
  }
  return events;
};

describe("Flagship: Healing Salve end-to-end integration", () => {
  it("gains 3 life for controller — life 20 → 23, pool empty, Salve in graveyard", () => {
    const game = makeGame();
    const seat0 = mkPlayerSeat(0); // caster / controller

    const salveId = mkEntityId(3000);

    // 1. Parse Healing Salve definition and build PaperCard
    const def = parseCard(salveSrc, "healing_salve.txt");
    const salvePaper: PaperCard = {
      name: "Healing Salve",
      edition: "LEA",
      collectorNumber: "19",
      language: "en",
      foil: false,
      flags: DEFAULT_PAPER_CARD_FLAGS,
      definition: def,
    };

    // 2. Add Healing Salve to caster's hand and activate abilities
    const salveCard = addCardToHand(game, salvePaper, seat0, salveId);
    salveCard.activateAbilitiesFromDefinition();

    // 3. Seed 1 W in caster's mana pool
    const pool = new ManaPool();
    pool.add(ManaProduced.colored(Color.White));
    game.getPlayer(seat0).manaPool = pool;

    // Verify initial state
    expect(game.getPlayer(seat0).life).toBe(20);
    expect(pool.size()).toBe(1);
    expect(salveCard.zone).toBe(ZoneType.Hand);

    // 4. Run CastPipeline
    const proposal: CastProposal = {
      castingPlayer: seat0,
      sourceCardId: salveId,
      originZone: ZoneType.Hand,
      asSpecialAction: false,
    };
    const { events: castEvents, result: stackItem } = drainCast(
      game.castPipeline.run(proposal) as Generator<{ kind: string }, StackItem | null, unknown>,
    );

    // Cast must succeed
    expect(stackItem).not.toBeNull();
    expect(castEvents).toContain("CostPaid");
    expect(castEvents).toContain("SpellCast");
    // Pool drained after payment
    expect(pool.size()).toBe(0);

    // 5. Resolve the stack item — GainLife targets the controller
    const resolveEvents = drainResolver(
      resolveStackItem(game, stackItem as StackItem) as Generator<unknown, void, unknown>,
    );

    // 6. Assertions
    // Controller life: 20 + 3 = 23
    expect(game.getPlayer(seat0).life).toBe(23);
    // Pool still empty (no refund after successful resolve)
    expect(pool.size()).toBe(0);
    // StackItemResolved event fired
    expect(resolveEvents).toContain("StackItemResolved");
    // Healing Salve moved to graveyard
    expect(salveCard.zone).toBe(ZoneType.Graveyard);
    // Stack is empty
    expect(game.sharedZones.stack.size).toBe(0);
  });

  it("LifeChanged event fired with newLife 23", () => {
    const game = makeGame();
    const seat0 = mkPlayerSeat(0);
    const salveId = mkEntityId(4000);

    const def = parseCard(salveSrc, "healing_salve.txt");
    const salvePaper: PaperCard = {
      name: "Healing Salve",
      edition: "LEA",
      collectorNumber: "19",
      language: "en",
      foil: false,
      flags: DEFAULT_PAPER_CARD_FLAGS,
      definition: def,
    };
    const salveCard = addCardToHand(game, salvePaper, seat0, salveId);
    salveCard.activateAbilitiesFromDefinition();

    const pool = new ManaPool();
    pool.add(ManaProduced.colored(Color.White));
    game.getPlayer(seat0).manaPool = pool;

    const { result: stackItem } = drainCast(
      game.castPipeline.run({
        castingPlayer: seat0,
        sourceCardId: salveId,
        originZone: ZoneType.Hand,
        asSpecialAction: false,
      }) as Generator<{ kind: string }, StackItem | null, unknown>,
    );
    expect(stackItem).not.toBeNull();

    const allEvents: { kind: string; payload?: unknown }[] = [];
    const gen = resolveStackItem(game, stackItem as StackItem) as Generator<
      { kind: string; event?: { kind: string; payload?: unknown } },
      void,
      unknown
    >;
    let step = gen.next();
    while (!step.done) {
      const y = step.value;
      if (y.kind === "event" && y.event) {
        allEvents.push({ kind: y.event.kind, payload: y.event.payload });
      }
      if (y.kind === "decision") {
        const req = y as unknown as { request?: { kind?: string; replacementIds?: number[] } };
        if (req.request?.kind === "orderReplacements") {
          step = gen.next({ order: [...(req.request.replacementIds ?? [])] });
          continue;
        }
      }
      step = gen.next();
    }

    const lifeEvent = allEvents.find((e) => e.kind === "LifeChanged");
    expect(lifeEvent).toBeDefined();
    const payload = lifeEvent?.payload as { oldLife?: number; newLife?: number } | undefined;
    expect(payload?.newLife).toBe(23);
    expect(payload?.oldLife).toBe(20);
  });
});
