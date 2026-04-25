// SPDX-License-Identifier: GPL-3.0-or-later
// SumPower / SumToughness / SumCMC selector tests.
import type { LobbyPlayer, ManaCostAst, PaperCard } from "@mtg-forge-ts/core";
import {
  CardType,
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
import { Graveyard } from "../../zone/zones/graveyard.js";
import { Hand } from "../../zone/zones/hand.js";
import { Library } from "../../zone/zones/library.js";
import type { SvarContext } from "../context.js";
import { evaluateExpression } from "../evaluator.js";
import "./sum-aggregates.js";

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

/** Build a Creature PaperCard with given P/T and mana cost. */
const mkCreaturePaper = (power: string, toughness: string, manaCostRaw: string): PaperCard => ({
  name: "Test Creature",
  edition: "TST",
  collectorNumber: "001",
  language: "en",
  foil: false,
  flags: DEFAULT_PAPER_CARD_FLAGS,
  definition: {
    name: "Test Creature",
    oracle: "",
    types: TypeLine.parse("Creature"),
    manaCost: { raw: manaCostRaw, symbols: [] } satisfies ManaCostAst,
    pt: { power, toughness },
    abilities: [],
    triggers: [],
    replacements: [],
    statics: [],
    keywords: [],
    svars: new Map(),
  },
});

/** Build a non-Creature PaperCard with given CMC. */
const mkSorceryPaper = (manaCostRaw: string): PaperCard => ({
  name: "Test Sorcery",
  edition: "TST",
  collectorNumber: "002",
  language: "en",
  foil: false,
  flags: DEFAULT_PAPER_CARD_FLAGS,
  definition: {
    name: "Test Sorcery",
    oracle: "",
    types: TypeLine.parse("Sorcery"),
    manaCost: { raw: manaCostRaw, symbols: [] } satisfies ManaCostAst,
    abilities: [],
    triggers: [],
    replacements: [],
    statics: [],
    keywords: [],
    svars: new Map(),
  },
});

const mkCtx = (game: Game, controller = mkPlayerSeat(0)): SvarContext => ({
  game,
  svars: new Map(),
  controller,
});

describe("SumPower selector", () => {
  it("SumPower$Creature — sums power of all Creatures on battlefield", () => {
    const game = mkGame();
    const seat0 = mkPlayerSeat(0);
    const seat1 = mkPlayerSeat(1);

    // seat0: two 2/2 creatures
    game.cards.set(
      mkEntityId(10),
      new Card(mkEntityId(10), mkCreaturePaper("2", "2", "1G"), seat0, seat0, ZoneType.Battlefield),
    );
    game.cards.set(
      mkEntityId(11),
      new Card(mkEntityId(11), mkCreaturePaper("2", "2", "1G"), seat0, seat0, ZoneType.Battlefield),
    );
    // seat1: one 3/3 creature
    game.cards.set(
      mkEntityId(20),
      new Card(mkEntityId(20), mkCreaturePaper("3", "3", "2G"), seat1, seat1, ZoneType.Battlefield),
    );

    const result = evaluateExpression(
      { kind: "SumPower", raw: "SumPower$Creature", args: [{ kind: "arg", raw: "Creature" }] },
      mkCtx(game, seat0),
    );
    expect(result).toBe(7); // 2 + 2 + 3
  });

  it("SumPower$Creature.YouCtrl — sums only controller's creatures", () => {
    const game = mkGame();
    const seat0 = mkPlayerSeat(0);
    const seat1 = mkPlayerSeat(1);

    game.cards.set(
      mkEntityId(10),
      new Card(mkEntityId(10), mkCreaturePaper("2", "2", "1G"), seat0, seat0, ZoneType.Battlefield),
    );
    game.cards.set(
      mkEntityId(11),
      new Card(mkEntityId(11), mkCreaturePaper("2", "2", "1G"), seat0, seat0, ZoneType.Battlefield),
    );
    game.cards.set(
      mkEntityId(20),
      new Card(mkEntityId(20), mkCreaturePaper("3", "3", "2G"), seat1, seat1, ZoneType.Battlefield),
    );

    const result = evaluateExpression(
      {
        kind: "SumPower",
        raw: "SumPower$Creature.YouCtrl",
        args: [{ kind: "arg", raw: "Creature.YouCtrl" }],
      },
      mkCtx(game, seat0),
    );
    expect(result).toBe(4); // 2 + 2 (seat0 only)
  });

  it("SumPower$Creature.OpponentCtrl — sums opponent's creatures", () => {
    const game = mkGame();
    const seat0 = mkPlayerSeat(0);
    const seat1 = mkPlayerSeat(1);

    game.cards.set(
      mkEntityId(10),
      new Card(mkEntityId(10), mkCreaturePaper("2", "2", "1G"), seat0, seat0, ZoneType.Battlefield),
    );
    game.cards.set(
      mkEntityId(11),
      new Card(mkEntityId(11), mkCreaturePaper("2", "2", "1G"), seat0, seat0, ZoneType.Battlefield),
    );
    game.cards.set(
      mkEntityId(20),
      new Card(mkEntityId(20), mkCreaturePaper("3", "3", "2G"), seat1, seat1, ZoneType.Battlefield),
    );

    const result = evaluateExpression(
      {
        kind: "SumPower",
        raw: "SumPower$Creature.OpponentCtrl",
        args: [{ kind: "arg", raw: "Creature.OpponentCtrl" }],
      },
      mkCtx(game, seat0),
    );
    expect(result).toBe(3); // 3 (seat1 only)
  });

  it("SumPower ignores cards not on the battlefield", () => {
    const game = mkGame();
    const seat0 = mkPlayerSeat(0);

    // Battlefield creature
    game.cards.set(
      mkEntityId(10),
      new Card(mkEntityId(10), mkCreaturePaper("2", "2", "1G"), seat0, seat0, ZoneType.Battlefield),
    );
    // Hand creature (should NOT count)
    game.cards.set(
      mkEntityId(11),
      new Card(mkEntityId(11), mkCreaturePaper("5", "5", "3G"), seat0, seat0, ZoneType.Hand),
    );
    // Graveyard creature (should NOT count)
    game.cards.set(
      mkEntityId(12),
      new Card(mkEntityId(12), mkCreaturePaper("4", "4", "2G"), seat0, seat0, ZoneType.Graveyard),
    );

    const result = evaluateExpression(
      { kind: "SumPower", raw: "SumPower$Creature", args: [{ kind: "arg", raw: "Creature" }] },
      mkCtx(game, seat0),
    );
    expect(result).toBe(2); // only the battlefield creature
  });

  it("SumPower filters non-creatures when filter is Creature", () => {
    const game = mkGame();
    const seat0 = mkPlayerSeat(0);

    game.cards.set(
      mkEntityId(10),
      new Card(mkEntityId(10), mkCreaturePaper("2", "2", "1G"), seat0, seat0, ZoneType.Battlefield),
    );
    // Sorcery on battlefield (e.g., animate-all scenario) — should NOT count for Creature filter
    game.cards.set(
      mkEntityId(11),
      new Card(mkEntityId(11), mkSorceryPaper("3"), seat0, seat0, ZoneType.Battlefield),
    );

    const result = evaluateExpression(
      { kind: "SumPower", raw: "SumPower$Creature", args: [{ kind: "arg", raw: "Creature" }] },
      mkCtx(game, seat0),
    );
    expect(result).toBe(2); // only the creature
  });

  it("SumPower returns 0 with no matching creatures", () => {
    const game = mkGame();
    const seat0 = mkPlayerSeat(0);
    // No creatures on battlefield
    const result = evaluateExpression(
      { kind: "SumPower", raw: "SumPower$Creature", args: [{ kind: "arg", raw: "Creature" }] },
      mkCtx(game, seat0),
    );
    expect(result).toBe(0);
  });
});

describe("SumToughness selector", () => {
  it("SumToughness$Creature — sums toughness of all creatures", () => {
    const game = mkGame();
    const seat0 = mkPlayerSeat(0);
    const seat1 = mkPlayerSeat(1);

    game.cards.set(
      mkEntityId(10),
      new Card(mkEntityId(10), mkCreaturePaper("2", "3", "1G"), seat0, seat0, ZoneType.Battlefield),
    );
    game.cards.set(
      mkEntityId(20),
      new Card(mkEntityId(20), mkCreaturePaper("1", "4", "G"), seat1, seat1, ZoneType.Battlefield),
    );

    const result = evaluateExpression(
      { kind: "SumToughness", raw: "SumToughness$Creature", args: [{ kind: "arg", raw: "Creature" }] },
      mkCtx(game, seat0),
    );
    expect(result).toBe(7); // 3 + 4
  });
});

describe("SumCMC selector", () => {
  it("SumCMC$Creature — sums CMC of all creatures on battlefield", () => {
    const game = mkGame();
    const seat0 = mkPlayerSeat(0);
    const seat1 = mkPlayerSeat(1);

    // CMC 2 (1G), CMC 3 (2G), CMC 4 (3G)
    game.cards.set(
      mkEntityId(10),
      new Card(mkEntityId(10), mkCreaturePaper("2", "2", "1G"), seat0, seat0, ZoneType.Battlefield),
    );
    game.cards.set(
      mkEntityId(11),
      new Card(mkEntityId(11), mkCreaturePaper("3", "3", "2G"), seat0, seat0, ZoneType.Battlefield),
    );
    game.cards.set(
      mkEntityId(20),
      new Card(mkEntityId(20), mkCreaturePaper("4", "4", "3G"), seat1, seat1, ZoneType.Battlefield),
    );

    const result = evaluateExpression(
      { kind: "SumCMC", raw: "SumCMC$Creature", args: [{ kind: "arg", raw: "Creature" }] },
      mkCtx(game, seat0),
    );
    expect(result).toBe(9); // 2 + 3 + 4
  });

  it("SumCMC with non-creature filter sums CMC of all battlefield permanents", () => {
    const game = mkGame();
    const seat0 = mkPlayerSeat(0);

    // A creature (CMC 2) and a sorcery (CMC 3) on battlefield
    game.cards.set(
      mkEntityId(10),
      new Card(mkEntityId(10), mkCreaturePaper("2", "2", "1G"), seat0, seat0, ZoneType.Battlefield),
    );
    game.cards.set(
      mkEntityId(11),
      new Card(mkEntityId(11), mkSorceryPaper("2R"), seat0, seat0, ZoneType.Battlefield),
    );

    // Filter by Creature only → should be 2 (just the creature's CMC)
    const result = evaluateExpression(
      { kind: "SumCMC", raw: "SumCMC$Creature", args: [{ kind: "arg", raw: "Creature" }] },
      mkCtx(game, seat0),
    );
    expect(result).toBe(2);
  });
});

describe("CardType filter edge cases", () => {
  it("SumPower without filter arg sums all battlefield cards (no type restriction)", () => {
    const game = mkGame();
    const seat0 = mkPlayerSeat(0);

    // Creature (power 2) and Sorcery (power null → 0) on battlefield
    game.cards.set(
      mkEntityId(10),
      new Card(mkEntityId(10), mkCreaturePaper("2", "2", "1G"), seat0, seat0, ZoneType.Battlefield),
    );
    game.cards.set(
      mkEntityId(11),
      new Card(mkEntityId(11), mkSorceryPaper("3"), seat0, seat0, ZoneType.Battlefield),
    );

    // No args → sums all battlefield cards
    const result = evaluateExpression({ kind: "SumPower", raw: "SumPower", args: [] }, mkCtx(game, seat0));
    expect(result).toBe(2); // creature contributes 2, sorcery contributes 0 (null P/T)
  });
});
