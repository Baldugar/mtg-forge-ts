// SPDX-License-Identifier: GPL-3.0-or-later
// Count$Domain selector tests — Wave 12C.
import type { LobbyPlayer, ManaCostAst, PaperCard } from "@mtg-forge-ts/core";
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
import { Graveyard } from "../../zone/zones/graveyard.js";
import { Hand } from "../../zone/zones/hand.js";
import { Library } from "../../zone/zones/library.js";
import type { SvarContext } from "../context.js";
import { evaluateExpression } from "../evaluator.js";
// Side-effect: register the Count selector first, then domain (which extends Count).
import "./count.js";
import "./domain.js";

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
    player.zones.set(ZoneType.Graveyard, new Graveyard(ZoneType.Graveyard, player.seat));
    player.zones.set(ZoneType.Battlefield, new Battlefield(ZoneType.Battlefield, player.seat));
  }
  return game;
};

const mkLandPaper = (subtype: string, name = `Basic ${subtype}`): PaperCard => ({
  name,
  edition: "TST",
  collectorNumber: "1",
  language: "en",
  foil: false,
  flags: DEFAULT_PAPER_CARD_FLAGS,
  definition: {
    name,
    oracle: "",
    types: TypeLine.parse(`Basic Land — ${subtype}`),
    manaCost: { raw: "", symbols: [] } satisfies ManaCostAst,
    abilities: [],
    triggers: [],
    replacements: [],
    statics: [],
    keywords: [],
    svars: new Map(),
  },
});

const mkDualLandPaper = (subtypes: readonly string[], name = "Tundra"): PaperCard => ({
  name,
  edition: "TST",
  collectorNumber: "2",
  language: "en",
  foil: false,
  flags: DEFAULT_PAPER_CARD_FLAGS,
  definition: {
    name,
    oracle: "",
    types: TypeLine.parse(`Land — ${subtypes.join(" ")}`),
    manaCost: { raw: "", symbols: [] } satisfies ManaCostAst,
    abilities: [],
    triggers: [],
    replacements: [],
    statics: [],
    keywords: [],
    svars: new Map(),
  },
});

const mkNonbasicLandPaper = (name: string): PaperCard => ({
  name,
  edition: "TST",
  collectorNumber: "3",
  language: "en",
  foil: false,
  flags: DEFAULT_PAPER_CARD_FLAGS,
  definition: {
    name,
    oracle: "",
    // Non-basic land with no basic subtypes: e.g., "Land — Cave"
    types: TypeLine.parse("Land — Cave"),
    manaCost: { raw: "", symbols: [] } satisfies ManaCostAst,
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

const evalCountDomain = (game: Game, controller = mkPlayerSeat(0)): number =>
  evaluateExpression(
    { kind: "Count", raw: "Count$Domain", args: [{ kind: "literal", raw: "Domain" }] },
    mkCtx(game, controller),
  );

const evalDomainDirect = (game: Game, controller = mkPlayerSeat(0)): number =>
  evaluateExpression({ kind: "Domain", raw: "Domain", args: [] }, mkCtx(game, controller));

describe("Count$Domain selector", () => {
  it("zero lands → Domain = 0", () => {
    const game = mkGame();
    const seat0 = mkPlayerSeat(0);
    expect(evalCountDomain(game, seat0)).toBe(0);
  });

  it("only Forests (3 of them) → Domain = 1 (one distinct basic subtype)", () => {
    const game = mkGame();
    const seat0 = mkPlayerSeat(0);
    for (let i = 0; i < 3; i++) {
      const id = mkEntityId(100 + i);
      game.cards.set(id, new Card(id, mkLandPaper("Forest"), seat0, seat0, ZoneType.Battlefield));
    }
    expect(evalCountDomain(game, seat0)).toBe(1);
  });

  it("3 Forests + 2 Mountains → Domain = 2", () => {
    const game = mkGame();
    const seat0 = mkPlayerSeat(0);
    for (let i = 0; i < 3; i++) {
      const id = mkEntityId(200 + i);
      game.cards.set(id, new Card(id, mkLandPaper("Forest"), seat0, seat0, ZoneType.Battlefield));
    }
    for (let i = 0; i < 2; i++) {
      const id = mkEntityId(210 + i);
      game.cards.set(id, new Card(id, mkLandPaper("Mountain"), seat0, seat0, ZoneType.Battlefield));
    }
    expect(evalCountDomain(game, seat0)).toBe(2);
  });

  it("one of each basic land → Domain = 5 (max)", () => {
    const game = mkGame();
    const seat0 = mkPlayerSeat(0);
    const subtypes = ["Plains", "Island", "Swamp", "Mountain", "Forest"];
    for (let i = 0; i < subtypes.length; i++) {
      const id = mkEntityId(300 + i);
      const subtype = subtypes[i];
      if (subtype === undefined) throw new Error("test invariant");
      game.cards.set(id, new Card(id, mkLandPaper(subtype), seat0, seat0, ZoneType.Battlefield));
    }
    expect(evalCountDomain(game, seat0)).toBe(5);
  });

  it("non-basic land with no basic subtypes (Cave) → Domain = 0", () => {
    const game = mkGame();
    const seat0 = mkPlayerSeat(0);
    const id = mkEntityId(400);
    game.cards.set(
      id,
      new Card(id, mkNonbasicLandPaper("Cave of Echoes"), seat0, seat0, ZoneType.Battlefield),
    );
    expect(evalCountDomain(game, seat0)).toBe(0);
  });

  it("dual land (Tundra: Land — Plains Island) contributes BOTH Plains and Island", () => {
    const game = mkGame();
    const seat0 = mkPlayerSeat(0);
    const id = mkEntityId(500);
    game.cards.set(
      id,
      new Card(id, mkDualLandPaper(["Plains", "Island"], "Tundra"), seat0, seat0, ZoneType.Battlefield),
    );
    expect(evalCountDomain(game, seat0)).toBe(2);
  });

  it("opponent's lands are NOT counted", () => {
    const game = mkGame();
    const seat0 = mkPlayerSeat(0);
    const seat1 = mkPlayerSeat(1);
    // seat1 has 5 different basics — they MUST NOT count toward seat0's Domain.
    const subtypes = ["Plains", "Island", "Swamp", "Mountain", "Forest"];
    for (let i = 0; i < subtypes.length; i++) {
      const id = mkEntityId(600 + i);
      const subtype = subtypes[i];
      if (subtype === undefined) throw new Error("test invariant");
      game.cards.set(id, new Card(id, mkLandPaper(subtype), seat1, seat1, ZoneType.Battlefield));
    }
    // seat0 has nothing.
    expect(evalCountDomain(game, seat0)).toBe(0);
    // seat1's domain is 5.
    expect(evalCountDomain(game, seat1)).toBe(5);
  });

  it("direct Domain$ form (no Count$ wrapper) works as well", () => {
    const game = mkGame();
    const seat0 = mkPlayerSeat(0);
    const id = mkEntityId(800);
    game.cards.set(id, new Card(id, mkLandPaper("Forest"), seat0, seat0, ZoneType.Battlefield));
    expect(evalDomainDirect(game, seat0)).toBe(1);
  });

  it("lands NOT on the battlefield are ignored (graveyard, hand)", () => {
    const game = mkGame();
    const seat0 = mkPlayerSeat(0);
    // Forest in graveyard
    const gid = mkEntityId(700);
    game.cards.set(gid, new Card(gid, mkLandPaper("Forest"), seat0, seat0, ZoneType.Graveyard));
    // Mountain in hand
    const hid = mkEntityId(701);
    game.cards.set(hid, new Card(hid, mkLandPaper("Mountain"), seat0, seat0, ZoneType.Hand));
    expect(evalCountDomain(game, seat0)).toBe(0);
  });
});
