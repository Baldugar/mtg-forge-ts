// SPDX-License-Identifier: GPL-3.0-or-later
// CostForage tests — canPay / pay (both modes) + parseCostString integration.
import { parseCard } from "@mtg-forge-ts/cards";
import type { GameEvent, LobbyPlayer, PaperCard } from "@mtg-forge-ts/core";
import { DEFAULT_PAPER_CARD_FLAGS, SeededRng, ZoneType, mkEntityId, mkPlayerSeat } from "@mtg-forge-ts/core";
import { describe, expect, it } from "vitest";
import "../../ability/effects/index.js";
import { Card } from "../../card.js";
import type { GameMeta } from "../../game-meta.js";
import type { GameRules } from "../../game-rules.js";
import { Game } from "../../game.js";
import { Battlefield } from "../../zone/zones/battlefield.js";
import { Exile } from "../../zone/zones/exile.js";
import { Graveyard } from "../../zone/zones/graveyard.js";
import { Hand } from "../../zone/zones/hand.js";
import { Library } from "../../zone/zones/library.js";
import { CostForage } from "./cost-forage.js";
import { parseCostString } from "./cost-payment.js";

const alice: LobbyPlayer = { id: "P0", name: "Alice", controllerKind: "human" };
const bob: LobbyPlayer = { id: "P1", name: "Bob", controllerKind: "ai" };
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
  forgeSha: "test",
  cardDataSyncedAt: "2026-04-24T00:00:00Z",
  crVersion: "2024-11-08",
  seed: "42",
};
const mkGame = (): Game => {
  const g = new Game({ lobbyPlayers: [alice, bob], rules, meta, rng: new SeededRng(42n) });
  for (const player of g.players) {
    player.zones.set(ZoneType.Library, new Library(ZoneType.Library, player.seat));
    player.zones.set(ZoneType.Hand, new Hand(ZoneType.Hand, player.seat));
    player.zones.set(ZoneType.Graveyard, new Graveyard(ZoneType.Graveyard, player.seat));
    player.zones.set(ZoneType.Battlefield, new Battlefield(ZoneType.Battlefield, player.seat));
    player.zones.set(ZoneType.Exile, new Exile(ZoneType.Exile, player.seat));
  }
  return g;
};

const bearSrc = `${["Name:Bear", "ManaCost:1 G", "Types:Creature Bear", "PT:2/2", "Oracle:vanilla"].join("\n")}\n`;
const foodSrc = `${[
  "Name:Food Token",
  "Types:Artifact Food",
  "Oracle:Food token (1, Sacrifice this artifact: gain 3 life).",
].join("\n")}\n`;
const sourceSrc = `${[
  "Name:Forage Source",
  "ManaCost:G",
  "Types:Creature Animal",
  "PT:1/1",
  "K:Forage",
  "Oracle:Forage",
].join("\n")}\n`;

const mkPaper = (src: string, name: string): PaperCard => ({
  name,
  edition: "TST",
  collectorNumber: "1",
  language: "en",
  foil: false,
  flags: DEFAULT_PAPER_CARD_FLAGS,
  definition: parseCard(src, `${name}.txt`),
});

describe("parseCostString — Forage segment", () => {
  it("recognizes 'Forage' and 'G, Forage'", () => {
    const a = parseCostString("Forage");
    expect(a.parts.map((p) => p.handlerKey)).toEqual(["Forage"]);
    const b = parseCostString("G, Forage");
    expect(b.parts.map((p) => p.handlerKey)).toEqual(["Mana", "Forage"]);
  });
});

describe("CostForage.canPay", () => {
  it("returns true when graveyard has ≥3 cards and no Food", () => {
    const game = mkGame();
    const seat = mkPlayerSeat(0);
    const sourceId = mkEntityId(401);
    const source = new Card(sourceId, mkPaper(sourceSrc, "Forage Source"), seat, seat, ZoneType.Battlefield);
    game.cards.set(sourceId, source);

    const gy = game.getPlayer(seat).zones.get(ZoneType.Graveyard);
    for (let i = 0; i < 3; i++) {
      const id = mkEntityId(500 + i);
      game.cards.set(id, new Card(id, mkPaper(bearSrc, `B${i}`), seat, seat, ZoneType.Graveyard));
      gy?.add(id);
    }
    expect(CostForage.canPay({ game, payerSeat: seat, sourceCardId: sourceId, raw: "Forage" })).toBe(true);
  });

  it("returns true with no graveyard cards but a Food token in play", () => {
    const game = mkGame();
    const seat = mkPlayerSeat(0);
    const sourceId = mkEntityId(402);
    const source = new Card(sourceId, mkPaper(sourceSrc, "Forage Source"), seat, seat, ZoneType.Battlefield);
    game.cards.set(sourceId, source);

    const foodId = mkEntityId(403);
    const food = new Card(foodId, mkPaper(foodSrc, "Food Token"), seat, seat, ZoneType.Battlefield);
    game.cards.set(foodId, food);
    game.getPlayer(seat).zones.get(ZoneType.Battlefield)?.add(foodId);
    expect(CostForage.canPay({ game, payerSeat: seat, sourceCardId: sourceId, raw: "Forage" })).toBe(true);
  });

  it("returns false with no graveyard ≥3 and no Food", () => {
    const game = mkGame();
    const seat = mkPlayerSeat(0);
    const sourceId = mkEntityId(404);
    const source = new Card(sourceId, mkPaper(sourceSrc, "Forage Source"), seat, seat, ZoneType.Battlefield);
    game.cards.set(sourceId, source);
    expect(CostForage.canPay({ game, payerSeat: seat, sourceCardId: sourceId, raw: "Forage" })).toBe(false);
  });
});

describe("CostForage.pay", () => {
  it("exileGy mode exiles 3 graveyard cards and emits CardForage", () => {
    const game = mkGame();
    const seat = mkPlayerSeat(0);
    const sourceId = mkEntityId(410);
    const source = new Card(sourceId, mkPaper(sourceSrc, "Forage Source"), seat, seat, ZoneType.Battlefield);
    game.cards.set(sourceId, source);

    const gy = game.getPlayer(seat).zones.get(ZoneType.Graveyard);
    const gyIds = [mkEntityId(411), mkEntityId(412), mkEntityId(413)];
    for (const id of gyIds) {
      game.cards.set(id, new Card(id, mkPaper(bearSrc, `g${id}`), seat, seat, ZoneType.Graveyard));
      gy?.add(id);
    }

    const ctx = { game, payerSeat: seat, sourceCardId: sourceId, raw: "Forage" } as const;
    const gen = CostForage.pay(ctx);
    let next = gen.next();
    const yields: unknown[] = [];
    while (!next.done) {
      const y = next.value;
      yields.push(y);
      const yObj = y as { kind?: string; request?: { kind?: string } };
      if (yObj.kind === "decision" && yObj.request?.kind === "chooseForageMode") {
        next = gen.next({ kind: "chooseForageMode", mode: "exileGy", cardIds: gyIds });
      } else {
        next = gen.next();
      }
    }
    expect(next.value?.handlerKey).toBe("Forage");
    for (const id of gyIds) {
      expect(game.cards.get(id)?.zone).toBe(ZoneType.Exile);
    }
    const forageEvts = yields.filter(
      (y) =>
        typeof y === "object" &&
        y !== null &&
        (y as { kind?: string }).kind === "event" &&
        ((y as { event: GameEvent }).event.kind as string) === "CardForage",
    );
    expect(forageEvts).toHaveLength(1);
  });

  it("sacFood mode sacrifices the chosen Food and emits CardForage", () => {
    const game = mkGame();
    const seat = mkPlayerSeat(0);
    const sourceId = mkEntityId(420);
    const source = new Card(sourceId, mkPaper(sourceSrc, "Forage Source"), seat, seat, ZoneType.Battlefield);
    game.cards.set(sourceId, source);

    const foodId = mkEntityId(421);
    const food = new Card(foodId, mkPaper(foodSrc, "Food Token"), seat, seat, ZoneType.Battlefield);
    food.isToken = true;
    game.cards.set(foodId, food);
    game.getPlayer(seat).zones.get(ZoneType.Battlefield)?.add(foodId);

    const ctx = { game, payerSeat: seat, sourceCardId: sourceId, raw: "Forage" } as const;
    const gen = CostForage.pay(ctx);
    let next = gen.next();
    const yields: unknown[] = [];
    while (!next.done) {
      const y = next.value;
      yields.push(y);
      const yObj = y as { kind?: string; request?: { kind?: string } };
      if (yObj.kind === "decision" && yObj.request?.kind === "chooseForageMode") {
        next = gen.next({ kind: "chooseForageMode", mode: "sacFood", foodId });
      } else {
        next = gen.next();
      }
    }
    expect(next.value?.handlerKey).toBe("Forage");
    // The Food has been moved out of the battlefield (or marked tokenness destroyed).
    const c = game.cards.get(foodId);
    expect(c === undefined || c.zone !== ZoneType.Battlefield).toBe(true);
    const forageEvts = yields.filter(
      (y) =>
        typeof y === "object" &&
        y !== null &&
        (y as { kind?: string }).kind === "event" &&
        ((y as { event: GameEvent }).event.kind as string) === "CardForage",
    );
    expect(forageEvts).toHaveLength(1);
  });
});
