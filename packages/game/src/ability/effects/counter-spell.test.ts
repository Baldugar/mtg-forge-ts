// SPDX-License-Identifier: GPL-3.0-or-later
// CounterSpellEffect test — a Counterspell targets a Lightning Bolt on the
// stack; after resolve the stack is empty and the bolt is in the graveyard.
import "./counter-spell.js";
import type { LobbyPlayer, PaperCard } from "@mtg-forge-ts/core";
import { DEFAULT_PAPER_CARD_FLAGS, SeededRng, ZoneType, mkEntityId, mkPlayerSeat } from "@mtg-forge-ts/core";
import { describe, expect, it } from "vitest";
import { Card } from "../../card.js";
import type { GameMeta } from "../../game-meta.js";
import type { GameRules } from "../../game-rules.js";
import { Game } from "../../game.js";
import type { StackItem } from "../../stack/stack-item.js";
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

const mkPaper = (name: string): PaperCard => ({
  name,
  edition: "LEA",
  collectorNumber: "001",
  language: "en",
  foil: false,
  flags: DEFAULT_PAPER_CARD_FLAGS,
});

const mkGame = (): Game => {
  const game = new Game({ lobbyPlayers: [alice, bob], rules, meta, rng: new SeededRng(1n) });
  for (const player of game.players) {
    player.zones.set(ZoneType.Library, new Library(ZoneType.Library, player.seat));
    player.zones.set(ZoneType.Hand, new Hand(ZoneType.Hand, player.seat));
    player.zones.set(ZoneType.Graveyard, new Graveyard(ZoneType.Graveyard, player.seat));
    player.zones.set(ZoneType.Battlefield, new Battlefield(ZoneType.Battlefield, player.seat));
  }
  return game;
};

const drainGen = (gen: Generator<unknown, void, unknown>): void => {
  let r = gen.next();
  while (!r.done) r = gen.next();
};

describe("CounterSpellEffect", () => {
  it("counters a spell — removes it from stack and moves source card to graveyard", () => {
    const game = mkGame();
    const seat0 = mkPlayerSeat(0);
    const seat1 = mkPlayerSeat(1);

    // bolt: the card being cast (will end up in the stack, then graveyard)
    const boltId = mkEntityId(10);
    const boltStackItemId = mkEntityId(11);
    const counterspellId = mkEntityId(20);

    // The bolt's source card is tracked in Hand (representing the zone it
    // came from before being cast; it stays there until resolution for the
    // purposes of locate() which excludes the Stack zone deliberately).
    const bolt = new Card(boltId, mkPaper("Lightning Bolt"), seat1, seat1, ZoneType.Hand);
    const counterspell = new Card(counterspellId, mkPaper("Counterspell"), seat0, seat0, ZoneType.Hand);
    game.cards.set(boltId, bolt);
    game.cards.set(counterspellId, counterspell);

    // Add bolt to hand zone so locate() can find it for the moveTo call.
    const hand1 = game.getPlayer(seat1).zones.get(ZoneType.Hand);
    hand1?.add(boltId);

    const gy1 = game.getPlayer(seat1).zones.get(ZoneType.Graveyard);

    // Build a minimal StackItem representing the bolt on the stack.
    const boltStackItem: StackItem = {
      id: boltStackItemId,
      sourceCardId: boltId,
      controllerSeat: seat1,
      kind: "spell",
      isCast: true,
      targets: [],
      modes: [],
      xValue: null,
      costPaid: null,
      provenance: {
        originZone: ZoneType.Hand,
        altCostUsed: null,
        additionalCostsPaid: [],
      },
    };
    game.sharedZones.stack.push(boltStackItem);
    expect(game.sharedZones.stack.size).toBe(1);

    // Counterspell targets the bolt stack item.
    const sa = new SpellAbility(
      {
        kind: "spell",
        effect: {
          handlerKey: "Counter",
          params: {},
        },
        cost: { raw: "U U" },
      },
      counterspellId,
      seat0,
      new Map(),
      [boltStackItemId],
    );

    drainGen(sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>);

    // Stack should now be empty.
    expect(game.sharedZones.stack.size).toBe(0);

    // Bolt card should be in seat1's graveyard.
    expect(gy1?.contains(boltId)).toBe(true);
    expect(bolt.zone).toBe(ZoneType.Graveyard);
  });

  it("is a no-op when the targeted stack item is already gone (fizzle)", () => {
    const game = mkGame();
    const seat0 = mkPlayerSeat(0);
    const ghostId = mkEntityId(99);
    const counterspellId = mkEntityId(20);

    game.cards.set(
      counterspellId,
      new Card(counterspellId, mkPaper("Counterspell"), seat0, seat0, ZoneType.Battlefield),
    );

    const sa = new SpellAbility(
      {
        kind: "spell",
        effect: { handlerKey: "Counter", params: {} },
        cost: { raw: "U U" },
      },
      counterspellId,
      seat0,
      new Map(),
      [ghostId], // id not on stack
    );

    // Should not throw.
    expect(() =>
      drainGen(sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>),
    ).not.toThrow();
    expect(game.sharedZones.stack.size).toBe(0);
  });
});
