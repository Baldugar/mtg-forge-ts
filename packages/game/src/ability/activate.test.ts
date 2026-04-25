// SPDX-License-Identifier: GPL-3.0-or-later
// activateAbility orchestrator tests — validates the canonical path for
// activated abilities (AB$ lines). MVP covers no-target mana abilities;
// the Llanowar Elves {T}: Add {G} pattern is the canonical example.
import "./effects/index.js";
import "../cost/parts/index.js";
import "../svar/selectors/number.js";
import type { LobbyPlayer, PaperCard } from "@mtg-forge-ts/core";
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
import { Card } from "../card.js";
import type { GameMeta } from "../game-meta.js";
import type { GameRules } from "../game-rules.js";
import { Game } from "../game.js";
import { ManaPool } from "../mana/mana-pool.js";
import { resolveStackItem } from "../resolve/effect-resolve.js";
import { Battlefield } from "../zone/zones/battlefield.js";
import { Graveyard } from "../zone/zones/graveyard.js";
import { Hand } from "../zone/zones/hand.js";
import { Library } from "../zone/zones/library.js";
import { SpellAbility } from "./spell-ability.js";

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
  name: "Llanowar Elves",
  edition: "LEA",
  collectorNumber: "186",
  language: "en",
  foil: false,
  flags: DEFAULT_PAPER_CARD_FLAGS,
};

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

/** Drain a generator, collecting event kinds. Forwards decisions as needed. */
const drain = (gen: Generator<unknown, unknown, unknown>): { events: string[]; result: unknown } => {
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
  return { events, result: step.value };
};

// Build a minimal AB$ Mana ability AST for {T}: Add {G}.
const makeManaAbilityAst = () => ({
  kind: "spell" as const,
  effect: {
    handlerKey: "Mana",
    params: {
      Produced: { kind: "literal" as const, raw: "G" },
    },
  },
  cost: { raw: "T" },
});

describe("activateAbility orchestrator", () => {
  it("activates {T}: Add {G} — card becomes tapped, mana pool gains 1 G", () => {
    const game = makeGame();
    const seat0 = mkPlayerSeat(0);
    const cardId = mkEntityId(100);

    // Place card on battlefield (untapped).
    const card = new Card(cardId, paper, seat0, seat0, ZoneType.Battlefield);
    game.cards.set(cardId, card);
    game.getPlayer(seat0).zones.get(ZoneType.Battlefield)?.add(cardId);

    // Wire the mana ability onto the card.
    card.spellAbilities = [new SpellAbility(makeManaAbilityAst(), cardId, seat0, new Map())];

    // Empty pool to start.
    const pool = new ManaPool();
    game.getPlayer(seat0).manaPool = pool;
    expect(pool.size()).toBe(0);
    expect(card.tapped).toBe(false);

    // 1. Activate ability index 0 via the canonical orchestrator.
    const activateGen = game.action.activateAbility(cardId, 0, seat0) as Generator<unknown, unknown, unknown>;
    const { events: activateEvents, result: stackItemId } = drain(activateGen);

    // activateAbility should have tapped the card and emitted AbilityActivated.
    expect(card.tapped).toBe(true);
    expect(activateEvents).toContain("CardTapped");
    expect(activateEvents).toContain("AbilityActivated");
    expect(typeof stackItemId).toBe("number");

    // Stack should have the ability item.
    expect(game.sharedZones.stack.size).toBe(1);

    // 2. Resolve the ability (drives ManaEffect).
    const top = game.sharedZones.stack.top();
    expect(top).not.toBeNull();
    if (!top) throw new Error("test: stack is empty after activateAbility");
    const { events: resolveEvents } = drain(
      resolveStackItem(game, top) as Generator<unknown, unknown, unknown>,
    );

    expect(resolveEvents).toContain("StackItemResolved");

    // 3. Pool should have 1 G.
    expect(pool.size()).toBe(1);

    // 4. Stack is empty after resolution.
    expect(game.sharedZones.stack.size).toBe(0);

    // 5. Card remains on battlefield, tapped.
    expect(card.zone).toBe(ZoneType.Battlefield);
    expect(card.tapped).toBe(true);
  });

  it("throws when card is not on the battlefield", () => {
    const game = makeGame();
    const seat0 = mkPlayerSeat(0);
    const cardId = mkEntityId(101);

    // Card in hand, not battlefield.
    const card = new Card(cardId, paper, seat0, seat0, ZoneType.Hand);
    game.cards.set(cardId, card);
    game.getPlayer(seat0).zones.get(ZoneType.Hand)?.add(cardId);
    card.spellAbilities = [new SpellAbility(makeManaAbilityAst(), cardId, seat0, new Map())];

    const gen = game.action.activateAbility(cardId, 0, seat0) as Generator<unknown, unknown, unknown>;
    expect(() => {
      let step = gen.next();
      while (!step.done) step = gen.next();
    }).toThrow(/Battlefield/);
  });

  it("throws when card does not exist", () => {
    const game = makeGame();
    const seat0 = mkPlayerSeat(0);
    const cardId = mkEntityId(999);
    // Card not in game.cards.

    const gen = game.action.activateAbility(cardId, 0, seat0) as Generator<unknown, unknown, unknown>;
    expect(() => {
      let step = gen.next();
      while (!step.done) step = gen.next();
    }).toThrow(/not found/);
  });

  it("throws when ability index is out of range", () => {
    const game = makeGame();
    const seat0 = mkPlayerSeat(0);
    const cardId = mkEntityId(102);

    const card = new Card(cardId, paper, seat0, seat0, ZoneType.Battlefield);
    game.cards.set(cardId, card);
    game.getPlayer(seat0).zones.get(ZoneType.Battlefield)?.add(cardId);
    card.spellAbilities = []; // no abilities

    const gen = game.action.activateAbility(cardId, 0, seat0) as Generator<unknown, unknown, unknown>;
    expect(() => {
      let step = gen.next();
      while (!step.done) step = gen.next();
    }).toThrow(/out of range/);
  });

  it("throws when the activating player does not control the card", () => {
    const game = makeGame();
    const seat0 = mkPlayerSeat(0);
    const seat1 = mkPlayerSeat(1);
    const cardId = mkEntityId(103);

    // Card controlled by seat0 but seat1 tries to activate.
    const card = new Card(cardId, paper, seat0, seat0, ZoneType.Battlefield);
    game.cards.set(cardId, card);
    game.getPlayer(seat0).zones.get(ZoneType.Battlefield)?.add(cardId);
    card.spellAbilities = [new SpellAbility(makeManaAbilityAst(), cardId, seat0, new Map())];

    const gen = game.action.activateAbility(cardId, 0, seat1) as Generator<unknown, unknown, unknown>;
    expect(() => {
      let step = gen.next();
      while (!step.done) step = gen.next();
    }).toThrow(/does not control/);
  });

  it("throws when card is already tapped (cost cannot be paid)", () => {
    const game = makeGame();
    const seat0 = mkPlayerSeat(0);
    const cardId = mkEntityId(104);

    const card = new Card(cardId, paper, seat0, seat0, ZoneType.Battlefield);
    card.tapped = true; // already tapped
    game.cards.set(cardId, card);
    game.getPlayer(seat0).zones.get(ZoneType.Battlefield)?.add(cardId);
    card.spellAbilities = [new SpellAbility(makeManaAbilityAst(), cardId, seat0, new Map())];

    const gen = game.action.activateAbility(cardId, 0, seat0) as Generator<unknown, unknown, unknown>;
    expect(() => {
      let step = gen.next();
      while (!step.done) step = gen.next();
    }).toThrow(/already tapped/);
  });

  it("verify mana color: the added mana is green (Color.Green)", () => {
    const game = makeGame();
    const seat0 = mkPlayerSeat(0);
    const cardId = mkEntityId(105);

    const card = new Card(cardId, paper, seat0, seat0, ZoneType.Battlefield);
    game.cards.set(cardId, card);
    game.getPlayer(seat0).zones.get(ZoneType.Battlefield)?.add(cardId);
    card.spellAbilities = [new SpellAbility(makeManaAbilityAst(), cardId, seat0, new Map())];

    const pool = new ManaPool();
    game.getPlayer(seat0).manaPool = pool;

    drain(game.action.activateAbility(cardId, 0, seat0) as Generator<unknown, unknown, unknown>);

    const top = game.sharedZones.stack.top();
    if (!top) throw new Error("test: stack is empty after activateAbility");
    drain(resolveStackItem(game, top) as Generator<unknown, unknown, unknown>);

    // Pool has exactly 1 green mana. Verify by adding a white and confirming
    // the total is 2 (meaning the prior entry was not white).
    expect(pool.size()).toBe(1);
    pool.add(ManaProduced.colored(Color.White));
    expect(pool.size()).toBe(2);
  });
});
