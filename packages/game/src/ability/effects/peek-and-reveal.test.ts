// SPDX-License-Identifier: GPL-3.0-or-later
// Wave 4 — PeekAndRevealEffect tests.
// Verifies that PeekAndReveal emits a CardsRevealed event with the correct
// card IDs from the top of the library, without moving any cards.
import "./peek-and-reveal.js";
import type { LobbyPlayer, PaperCard } from "@mtg-forge-ts/core";
import { DEFAULT_PAPER_CARD_FLAGS, SeededRng, ZoneType, mkEntityId, mkPlayerSeat } from "@mtg-forge-ts/core";
import { describe, expect, it } from "vitest";
import type { EngineYield } from "../../action/engine-yield.js";
import { Card } from "../../card.js";
import type { GameMeta } from "../../game-meta.js";
import type { GameRules } from "../../game-rules.js";
import { Game } from "../../game.js";
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
  cardDataSyncedAt: "2026-04-24T00:00:00Z",
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

const drainGen = (gen: Generator<unknown, void, unknown>): EngineYield[] => {
  const yields: EngineYield[] = [];
  let r = gen.next();
  while (!r.done) {
    yields.push(r.value as EngineYield);
    r = gen.next();
  }
  return yields;
};

describe("PeekAndRevealEffect — Wave 4", () => {
  it("emits CardsRevealed with top-N library card IDs", () => {
    const game = mkGame();
    const seat0 = mkPlayerSeat(0);
    const sourceId = mkEntityId(10);
    game.cards.set(sourceId, new Card(sourceId, paper, seat0, seat0, ZoneType.Battlefield));

    // Put 3 cards in seat0's library (index 0 = top).
    const lib = game.getPlayer(seat0).zones.get(ZoneType.Library);
    if (!lib) throw new Error("test: missing Library zone");
    const c1 = mkEntityId(101);
    const c2 = mkEntityId(102);
    const c3 = mkEntityId(103);
    for (const id of [c1, c2, c3]) {
      game.cards.set(id, new Card(id, paper, seat0, seat0, ZoneType.Library));
      lib.add(id);
    }

    const sa = new SpellAbility(
      {
        kind: "spell",
        effect: {
          handlerKey: "PeekAndReveal",
          params: {
            Defined: { kind: "literal", raw: "Player.You" },
            NumCards: { kind: "literal", raw: "2" },
          },
        },
        cost: { raw: "" },
      },
      sourceId,
      seat0,
      new Map(),
      [],
    );

    const yields = drainGen(sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>);
    const revealEvents = yields.filter((y) => y.kind === "event" && y.event.kind === "CardsRevealed");
    expect(revealEvents).toHaveLength(1);

    const ev = revealEvents[0] as Extract<EngineYield, { kind: "event" }>;
    if (ev.event.kind !== "CardsRevealed") throw new Error("expected CardsRevealed");
    expect(ev.event.payload.fromZone).toBe(ZoneType.Library);
    expect(ev.event.payload.revealedTo).toBe("all");
    expect(ev.event.payload.cardIds).toHaveLength(2);
    expect(ev.event.payload.cardIds[0]).toBe(c1);
    expect(ev.event.payload.cardIds[1]).toBe(c2);
  });

  it("library order is unchanged after peeking", () => {
    const game = mkGame();
    const seat0 = mkPlayerSeat(0);
    const sourceId = mkEntityId(10);
    game.cards.set(sourceId, new Card(sourceId, paper, seat0, seat0, ZoneType.Battlefield));

    const lib = game.getPlayer(seat0).zones.get(ZoneType.Library);
    if (!lib) throw new Error("test: missing Library zone");
    const ids = [mkEntityId(201), mkEntityId(202), mkEntityId(203)];
    for (const id of ids) {
      game.cards.set(id, new Card(id, paper, seat0, seat0, ZoneType.Library));
      lib.add(id);
    }

    const sa = new SpellAbility(
      {
        kind: "spell",
        effect: {
          handlerKey: "PeekAndReveal",
          params: { NumCards: { kind: "literal", raw: "3" } },
        },
        cost: { raw: "" },
      },
      sourceId,
      seat0,
      new Map(),
      [],
    );

    drainGen(sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>);
    expect(lib.toArray()).toEqual(ids); // order unchanged
    expect(lib.size).toBe(3);
  });

  it("targets opponent library when Defined$ Player.Opponent", () => {
    const game = mkGame();
    const seat0 = mkPlayerSeat(0);
    const seat1 = mkPlayerSeat(1);
    const sourceId = mkEntityId(10);
    game.cards.set(sourceId, new Card(sourceId, paper, seat0, seat0, ZoneType.Battlefield));

    const lib1 = game.getPlayer(seat1).zones.get(ZoneType.Library);
    if (!lib1) throw new Error("test: missing Library zone for seat1");
    const oppCard = mkEntityId(301);
    game.cards.set(oppCard, new Card(oppCard, paper, seat1, seat1, ZoneType.Library));
    lib1.add(oppCard);

    const sa = new SpellAbility(
      {
        kind: "spell",
        effect: {
          handlerKey: "PeekAndReveal",
          params: { Defined: { kind: "literal", raw: "Player.Opponent" } },
        },
        cost: { raw: "" },
      },
      sourceId,
      seat0,
      new Map(),
      [],
    );

    const yields = drainGen(sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>);
    const ev = yields.find((y) => y.kind === "event" && y.event.kind === "CardsRevealed") as
      | Extract<EngineYield, { kind: "event" }>
      | undefined;
    expect(ev).toBeDefined();
    if (!ev || ev.event.kind !== "CardsRevealed") throw new Error("expected CardsRevealed");
    expect(ev.event.payload.revealedBy).toBe(seat1);
    expect(ev.event.payload.cardIds).toContain(oppCard);
  });

  it("emits nothing when library is empty", () => {
    const game = mkGame();
    const seat0 = mkPlayerSeat(0);
    const sourceId = mkEntityId(10);
    game.cards.set(sourceId, new Card(sourceId, paper, seat0, seat0, ZoneType.Battlefield));

    const sa = new SpellAbility(
      {
        kind: "spell",
        effect: {
          handlerKey: "PeekAndReveal",
          params: {},
        },
        cost: { raw: "" },
      },
      sourceId,
      seat0,
      new Map(),
      [],
    );

    const yields = drainGen(sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>);
    expect(yields).toHaveLength(0);
  });
});
