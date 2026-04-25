// SPDX-License-Identifier: GPL-3.0-or-later
// Tests for DigEffect — top-N library lookup with selective zone movement.
import "../../svar/selectors/number.js";
// Self-registering side effect.
import "./dig.js";
import type { DecisionResponse, EntityId, LobbyPlayer, PaperCard } from "@mtg-forge-ts/core";
import { DEFAULT_PAPER_CARD_FLAGS, SeededRng, ZoneType, mkEntityId, mkPlayerSeat } from "@mtg-forge-ts/core";
import { describe, expect, it } from "vitest";
import { Card } from "../../card.js";
import type { GameMeta } from "../../game-meta.js";
import type { GameRules } from "../../game-rules.js";
import { Game } from "../../game.js";
import type { Zone } from "../../zone/zone.js";
import { Battlefield } from "../../zone/zones/battlefield.js";
import { Graveyard } from "../../zone/zones/graveyard.js";
import { Hand } from "../../zone/zones/hand.js";
import { Library } from "../../zone/zones/library.js";
import { SpellAbility } from "../spell-ability.js";

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
  name: "Test",
  edition: "LEA",
  collectorNumber: "001",
  language: "en",
  foil: false,
  flags: DEFAULT_PAPER_CARD_FLAGS,
};

const mkGame = () => {
  const game = new Game({ lobbyPlayers: [alice, bob], rules, meta, rng: new SeededRng(1n) });
  for (const player of game.players) {
    player.zones.set(ZoneType.Library, new Library(ZoneType.Library, player.seat));
    player.zones.set(ZoneType.Hand, new Hand(ZoneType.Hand, player.seat));
    player.zones.set(ZoneType.Graveyard, new Graveyard(ZoneType.Graveyard, player.seat));
    player.zones.set(ZoneType.Battlefield, new Battlefield(ZoneType.Battlefield, player.seat));
  }
  return game;
};

const getZone = (game: Game, seat: ReturnType<typeof mkPlayerSeat>, type: ZoneType): Zone => {
  const z = game.getPlayer(seat).zones.get(type);
  if (!z) throw new Error(`Zone ${type} not set up for seat ${seat as unknown as number}`);
  return z;
};

/**
 * Drive a generator to completion, replying to the first "chooseCard"
 * decision with the provided chosen IDs.
 */
const drainWithChooseCard = (gen: Generator<unknown, void, unknown>, chosen: readonly EntityId[]): void => {
  let r = gen.next();
  while (!r.done) {
    const y = r.value as { kind?: string; request?: { kind?: string } } | undefined;
    if (y?.kind === "decision" && y.request && (y.request as { kind?: string }).kind === "chooseCard") {
      const resp: DecisionResponse = { kind: "chooseCard", chosen };
      r = gen.next(resp);
    } else {
      r = gen.next();
    }
  }
};

// Drain fully — no decision reply (uses deterministic fallback).
const drainGen = (gen: Generator<unknown, void, unknown>): void => {
  let r = gen.next();
  while (!r.done) r = gen.next();
};

describe("DigEffect", () => {
  it("Dig 3/2/Hand: peeks top 3, moves top 2 to hand, top 1 remains in library", () => {
    const game = mkGame();
    const seat0 = mkPlayerSeat(0);
    const sourceId = mkEntityId(10);

    // Library order (top-to-bottom): id30, id31, id32, id33, id34
    const idNums = [30, 31, 32, 33, 34];
    const ids = idNums.map((n) => mkEntityId(n));
    game.cards.set(sourceId, new Card(sourceId, paper, seat0, seat0, ZoneType.Battlefield));
    for (const id of ids) {
      game.cards.set(id, new Card(id, paper, seat0, seat0, ZoneType.Library));
      getZone(game, seat0, ZoneType.Library).add(id);
    }

    const sa = new SpellAbility(
      {
        kind: "spell",
        effect: {
          handlerKey: "Dig",
          params: {
            DigNum: { kind: "literal", raw: "3" },
            ChangeNum: { kind: "literal", raw: "2" },
            DestinationZone: { kind: "literal", raw: "Hand" },
          },
        },
        cost: { raw: "2 U" },
      },
      sourceId,
      seat0,
      new Map(),
    );

    const lib = getZone(game, seat0, ZoneType.Library);
    const hand = getZone(game, seat0, ZoneType.Hand);

    // The peeked cards are top-3: id30, id31, id32.
    // Choose id30 and id31 for hand; id32 goes back to library top.
    const id30 = ids[0] as EntityId;
    const id31 = ids[1] as EntityId;
    const id32 = ids[2] as EntityId;
    drainWithChooseCard(sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>, [id30, id31]);

    // Hand gained 2 cards.
    expect(hand.size).toBe(2);
    expect(hand.contains(id30)).toBe(true);
    expect(hand.contains(id31)).toBe(true);

    // Library still has 3 cards (id32 returned to top + id33 + id34).
    expect(lib.size).toBe(3);
    expect(lib.contains(id32)).toBe(true);
    expect(lib.contains(id30)).toBe(false);
    expect(lib.contains(id31)).toBe(false);
  });

  it("deterministic fallback: first ChangeNum cards go to hand when no driver", () => {
    const game = mkGame();
    const seat0 = mkPlayerSeat(0);
    const sourceId = mkEntityId(10);

    const ids = [40, 41, 42].map((n) => mkEntityId(n));
    game.cards.set(sourceId, new Card(sourceId, paper, seat0, seat0, ZoneType.Battlefield));
    for (const id of ids) {
      game.cards.set(id, new Card(id, paper, seat0, seat0, ZoneType.Library));
      getZone(game, seat0, ZoneType.Library).add(id);
    }

    const sa = new SpellAbility(
      {
        kind: "spell",
        effect: {
          handlerKey: "Dig",
          params: {
            DigNum: { kind: "literal", raw: "3" },
            ChangeNum: { kind: "literal", raw: "1" },
            DestinationZone: { kind: "literal", raw: "Hand" },
          },
        },
        cost: { raw: "1 U" },
      },
      sourceId,
      seat0,
      new Map(),
    );

    const hand = getZone(game, seat0, ZoneType.Hand);
    const lib = getZone(game, seat0, ZoneType.Library);
    const id40 = ids[0] as EntityId;

    // No decision driver — fallback picks first peeked card (id40).
    drainGen(sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>);

    expect(hand.size).toBe(1);
    expect(hand.contains(id40)).toBe(true);
    expect(lib.size).toBe(2);
  });

  it("LibraryPosition$ -1: unchosen cards go to library bottom", () => {
    const game = mkGame();
    const seat0 = mkPlayerSeat(0);
    const sourceId = mkEntityId(10);

    // Library: [top=50, 51, 52]
    const ids = [50, 51, 52].map((n) => mkEntityId(n));
    game.cards.set(sourceId, new Card(sourceId, paper, seat0, seat0, ZoneType.Battlefield));
    for (const id of ids) {
      game.cards.set(id, new Card(id, paper, seat0, seat0, ZoneType.Library));
      getZone(game, seat0, ZoneType.Library).add(id);
    }

    const sa = new SpellAbility(
      {
        kind: "spell",
        effect: {
          handlerKey: "Dig",
          params: {
            DigNum: { kind: "literal", raw: "3" },
            ChangeNum: { kind: "literal", raw: "1" },
            DestinationZone: { kind: "literal", raw: "Hand" },
            LibraryPosition: { kind: "literal", raw: "-1" },
          },
        },
        cost: { raw: "2 U" },
      },
      sourceId,
      seat0,
      new Map(),
    );

    const lib = getZone(game, seat0, ZoneType.Library);
    const hand = getZone(game, seat0, ZoneType.Hand);
    const id50 = ids[0] as EntityId;
    const id51 = ids[1] as EntityId;
    const id52 = ids[2] as EntityId;

    // Choose top card (id50) for hand; id51 and id52 go to bottom.
    drainWithChooseCard(sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>, [id50]);

    expect(hand.size).toBe(1);
    expect(hand.contains(id50)).toBe(true);
    // Library has 2 cards at the bottom.
    expect(lib.size).toBe(2);
    expect(lib.contains(id51)).toBe(true);
    expect(lib.contains(id52)).toBe(true);
  });

  it("empty library — no-op, does not throw", () => {
    const game = mkGame();
    const seat0 = mkPlayerSeat(0);
    const sourceId = mkEntityId(10);

    game.cards.set(sourceId, new Card(sourceId, paper, seat0, seat0, ZoneType.Battlefield));

    const sa = new SpellAbility(
      {
        kind: "spell",
        effect: {
          handlerKey: "Dig",
          params: {
            DigNum: { kind: "literal", raw: "5" },
            ChangeNum: { kind: "literal", raw: "1" },
          },
        },
        cost: { raw: "2 U" },
      },
      sourceId,
      seat0,
      new Map(),
    );

    expect(() =>
      drainGen(sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>),
    ).not.toThrow();
  });
});
