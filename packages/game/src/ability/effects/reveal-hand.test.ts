// SPDX-License-Identifier: GPL-3.0-or-later
// Wave 4 — RevealHandEffect tests.
// Verifies that RevealHand emits a CardsRevealed event for the target
// player's entire hand.
import "./reveal-hand.js";
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

describe("RevealHandEffect — Wave 4", () => {
  it("defaults to opponent hand and emits CardsRevealed with all cards", () => {
    const game = mkGame();
    const seat0 = mkPlayerSeat(0);
    const seat1 = mkPlayerSeat(1);
    const sourceId = mkEntityId(10);
    game.cards.set(sourceId, new Card(sourceId, paper, seat0, seat0, ZoneType.Battlefield));

    // Populate opponent (seat1) hand.
    const hand1 = game.getPlayer(seat1).zones.get(ZoneType.Hand);
    if (!hand1) throw new Error("test: missing Hand zone for seat1");
    const h1 = mkEntityId(401);
    const h2 = mkEntityId(402);
    const h3 = mkEntityId(403);
    for (const id of [h1, h2, h3]) {
      game.cards.set(id, new Card(id, paper, seat1, seat1, ZoneType.Hand));
      hand1.add(id);
    }

    const sa = new SpellAbility(
      {
        kind: "spell",
        effect: {
          handlerKey: "RevealHand",
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
    const revealEvents = yields.filter((y) => y.kind === "event" && y.event.kind === "CardsRevealed");
    expect(revealEvents).toHaveLength(1);

    const ev = revealEvents[0] as Extract<EngineYield, { kind: "event" }>;
    if (ev.event.kind !== "CardsRevealed") throw new Error("expected CardsRevealed");
    expect(ev.event.payload.fromZone).toBe(ZoneType.Hand);
    expect(ev.event.payload.revealedTo).toBe("all");
    expect(ev.event.payload.revealedBy).toBe(seat1);
    expect(ev.event.payload.cardIds).toHaveLength(3);
    expect(ev.event.payload.cardIds).toContain(h1);
    expect(ev.event.payload.cardIds).toContain(h2);
    expect(ev.event.payload.cardIds).toContain(h3);
  });

  it("reveals own hand when Defined$ Player.You", () => {
    const game = mkGame();
    const seat0 = mkPlayerSeat(0);
    const sourceId = mkEntityId(10);
    game.cards.set(sourceId, new Card(sourceId, paper, seat0, seat0, ZoneType.Battlefield));

    const hand0 = game.getPlayer(seat0).zones.get(ZoneType.Hand);
    if (!hand0) throw new Error("test: missing Hand zone for seat0");
    const myCard = mkEntityId(501);
    game.cards.set(myCard, new Card(myCard, paper, seat0, seat0, ZoneType.Hand));
    hand0.add(myCard);

    const sa = new SpellAbility(
      {
        kind: "spell",
        effect: {
          handlerKey: "RevealHand",
          params: { Defined: { kind: "literal", raw: "Player.You" } },
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
    expect(ev.event.payload.revealedBy).toBe(seat0);
    expect(ev.event.payload.cardIds).toContain(myCard);
  });

  it("emits nothing when hand is empty", () => {
    const game = mkGame();
    const seat0 = mkPlayerSeat(0);
    const sourceId = mkEntityId(10);
    game.cards.set(sourceId, new Card(sourceId, paper, seat0, seat0, ZoneType.Battlefield));

    const sa = new SpellAbility(
      {
        kind: "spell",
        effect: {
          handlerKey: "RevealHand",
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
