// SPDX-License-Identifier: GPL-3.0-or-later
// common-counts.ts selector tests — Wave 12D corpus-audit closure.
import type { LobbyPlayer, PaperCard } from "@mtg-forge-ts/core";
import {
  DEFAULT_PAPER_CARD_FLAGS,
  SeededRng,
  TypeLine,
  ZoneType,
  mkEntityId,
  mkPlayerSeat,
} from "@mtg-forge-ts/core";
import { describe, expect, it } from "vitest";
import { Card } from "../../card.js";
import type { GameMeta } from "../../game-meta.js";
import type { GameRules } from "../../game-rules.js";
import { Game } from "../../game.js";
import { Battlefield } from "../../zone/zones/battlefield.js";
import { Hand } from "../../zone/zones/hand.js";
import { Library } from "../../zone/zones/library.js";
import type { SvarContext } from "../context.js";
import { evaluateExpression } from "../evaluator.js";
import "./common-counts.js";
import "./count.js";

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
  cardDataSyncedAt: "2026-04-26T00:00:00Z",
  crVersion: "2024-11-08",
  seed: "01",
};

const mkGame = (): Game => {
  const game = new Game({ lobbyPlayers: [alice, bob], rules, meta, rng: new SeededRng(1n) });
  for (const player of game.players) {
    player.zones.set(ZoneType.Library, new Library(ZoneType.Library, player.seat));
    player.zones.set(ZoneType.Hand, new Hand(ZoneType.Hand, player.seat));
    player.zones.set(ZoneType.Battlefield, new Battlefield(ZoneType.Battlefield, player.seat));
  }
  return game;
};

const mkPaper = (): PaperCard => ({
  name: "Source",
  edition: "TST",
  collectorNumber: "1",
  language: "en",
  foil: false,
  flags: DEFAULT_PAPER_CARD_FLAGS,
  definition: {
    name: "Source",
    oracle: "",
    types: TypeLine.parse("Artifact"),
    manaCost: { raw: "", symbols: [] },
    abilities: [],
    triggers: [],
    replacements: [],
    statics: [],
    keywords: [],
    svars: new Map(),
  },
});

const mkCtxWithSource = (game: Game, controller = mkPlayerSeat(0), sourceCardId?: number): SvarContext => ({
  game,
  svars: new Map(),
  controller,
  ...(sourceCardId !== undefined ? { sourceCardId: mkEntityId(sourceCardId) } : {}),
});

const evalCount = (game: Game, arg: string, controller = mkPlayerSeat(0), sourceCardId?: number): number =>
  evaluateExpression(
    { kind: "Count", raw: `Count$${arg}`, args: [{ kind: "literal", raw: arg }] },
    mkCtxWithSource(game, controller, sourceCardId),
  );

describe("Count$YourLifeTotal", () => {
  it("returns the controller's life total", () => {
    const game = mkGame();
    const seat0 = mkPlayerSeat(0);
    expect(evalCount(game, "YourLifeTotal", seat0)).toBe(20);
    game.getPlayer(seat0).life = 13;
    expect(evalCount(game, "YourLifeTotal", seat0)).toBe(13);
  });
});

describe("Count$OppLifeTotal", () => {
  it("returns the opponent's life total", () => {
    const game = mkGame();
    const seat0 = mkPlayerSeat(0);
    const seat1 = mkPlayerSeat(1);
    game.getPlayer(seat1).life = 7;
    expect(evalCount(game, "OppLifeTotal", seat0)).toBe(7);
  });
});

describe("Count$RememberedSize / RememberedNumber", () => {
  it("returns 0 when source card is unknown / no remembered", () => {
    const game = mkGame();
    const seat0 = mkPlayerSeat(0);
    const id = mkEntityId(100);
    const card = new Card(id, mkPaper(), seat0, seat0, ZoneType.Battlefield);
    game.cards.set(id, card);
    expect(evalCount(game, "RememberedSize", seat0, 100)).toBe(0);
  });

  it("returns the count of remembered EntityIds", () => {
    const game = mkGame();
    const seat0 = mkPlayerSeat(0);
    const id = mkEntityId(101);
    const card = new Card(id, mkPaper(), seat0, seat0, ZoneType.Battlefield);
    card.remembered.push(mkEntityId(200), mkEntityId(201), mkEntityId(202));
    game.cards.set(id, card);
    expect(evalCount(game, "RememberedSize", seat0, 101)).toBe(3);
    expect(evalCount(game, "RememberedNumber", seat0, 101)).toBe(3);
  });
});

describe("Count$YourPoisonCounters", () => {
  it("returns 0 by default (no poison)", () => {
    const game = mkGame();
    expect(evalCount(game, "YourPoisonCounters")).toBe(0);
  });
});
