// SPDX-License-Identifier: GPL-3.0-or-later
// Ensure svar selectors are registered.
import "../../svar/selectors/number.js";
// Import effect — self-registers in effectRegistry at module load.
import "./draw.js";
import type { LobbyPlayer, PaperCard } from "@mtg-forge-ts/core";
import { DEFAULT_PAPER_CARD_FLAGS, SeededRng, ZoneType, mkEntityId, mkPlayerSeat } from "@mtg-forge-ts/core";
import { describe, expect, it } from "vitest";
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

const drainGen = (gen: Generator<unknown, void, unknown>): void => {
  let r = gen.next();
  while (!r.done) r = gen.next();
};

describe("DrawEffect", () => {
  it("Draw 2 — controller hand grows by 2 (Divination)", () => {
    const game = mkGame();
    const seat0 = mkPlayerSeat(0);
    const sourceId = mkEntityId(1);
    const source = new Card(sourceId, paper, seat0, seat0, ZoneType.Battlefield);
    game.cards.set(sourceId, source);

    // Seed library with 3 cards
    const lib = game.getPlayer(seat0).zones.get(ZoneType.Library);
    if (!lib) throw new Error("missing library");
    for (let i = 10; i < 13; i++) {
      const id = mkEntityId(i);
      const card = new Card(id, paper, seat0, seat0, ZoneType.Library);
      game.cards.set(id, card);
      lib.add(id);
    }

    const hand = game.getPlayer(seat0).zones.get(ZoneType.Hand);
    const before = hand?.size ?? 0;

    const sa = new SpellAbility(
      {
        kind: "spell",
        effect: {
          handlerKey: "Draw",
          params: { NumCards: { kind: "literal", raw: "2" } },
        },
        cost: { raw: "1 U" },
      },
      sourceId,
      seat0,
      new Map(),
    );

    drainGen(sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>);
    expect(hand?.size).toBe(before + 2);
  });
});
