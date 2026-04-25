// SPDX-License-Identifier: GPL-3.0-or-later
// SetStateEffect tests — DFC transform, flip, turnFaceUp dispatch.
import "./set-state.js";
import type { LobbyPlayer, PaperCard } from "@mtg-forge-ts/core";
import { DEFAULT_PAPER_CARD_FLAGS, SeededRng, ZoneType, mkEntityId, mkPlayerSeat } from "@mtg-forge-ts/core";
import { describe, expect, it, vi } from "vitest";
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

// DFC paper card (transform DFC — has faces without isModalDfc).
const dfcPaper: PaperCard = {
  name: "Delver of Secrets",
  edition: "ISD",
  collectorNumber: "51",
  language: "en",
  foil: false,
  flags: DEFAULT_PAPER_CARD_FLAGS,
  faces: {
    front: { name: "Delver of Secrets" },
    back: { name: "Insectile Aberration" },
  },
};

const plainPaper: PaperCard = {
  name: "Plains",
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

const mkAst = (mode: string, defined = "Self") => ({
  kind: "spell" as const,
  effect: {
    handlerKey: "SetState",
    params: {
      Mode: { kind: "literal" as const, raw: mode },
      Defined: { kind: "literal" as const, raw: defined },
    },
  },
  cost: { raw: "" },
});

describe("SetStateEffect", () => {
  it("Mode$ Transform — calls game.action.transform on Defined$ Self (DFC card)", () => {
    const game = mkGame();
    const seat0 = mkPlayerSeat(0);
    const sourceId = mkEntityId(10);

    // Place a DFC card on the battlefield.
    const card = new Card(sourceId, dfcPaper, seat0, seat0, ZoneType.Battlefield);
    card.face = "front";
    game.cards.set(sourceId, card);
    game.getPlayer(seat0).zones.get(ZoneType.Battlefield)?.add(sourceId);

    const transformSpy = vi.spyOn(game.action, "transform");

    const sa = new SpellAbility(mkAst("Transform"), sourceId, seat0, new Map(), []);
    drainGen(sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>);

    expect(transformSpy).toHaveBeenCalledWith(sourceId);
    // Card face should have toggled to "back".
    expect(card.face).toBe("back");
  });

  it("Mode$ Transform toggles from back to front", () => {
    const game = mkGame();
    const seat0 = mkPlayerSeat(0);
    const sourceId = mkEntityId(10);

    const card = new Card(sourceId, dfcPaper, seat0, seat0, ZoneType.Battlefield);
    card.face = "back";
    game.cards.set(sourceId, card);
    game.getPlayer(seat0).zones.get(ZoneType.Battlefield)?.add(sourceId);

    const sa = new SpellAbility(mkAst("Transform"), sourceId, seat0, new Map(), []);
    drainGen(sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>);

    expect(card.face).toBe("front");
  });

  it("Mode$ Flip — calls game.action.flip on Defined$ Self", () => {
    const game = mkGame();
    const seat0 = mkPlayerSeat(0);
    const sourceId = mkEntityId(10);

    const flipPaper: PaperCard = {
      ...plainPaper,
      name: "Budoka Gardener",
      faces: { flipped: { name: "Dokai, Weaver of Life" } },
    };
    const card = new Card(sourceId, flipPaper, seat0, seat0, ZoneType.Battlefield);
    game.cards.set(sourceId, card);
    game.getPlayer(seat0).zones.get(ZoneType.Battlefield)?.add(sourceId);

    const flipSpy = vi.spyOn(game.action, "flip");

    const sa = new SpellAbility(mkAst("Flip"), sourceId, seat0, new Map(), []);
    drainGen(sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>);

    expect(flipSpy).toHaveBeenCalledWith(sourceId);
  });

  it("Mode$ TurnFaceUp — calls game.action.turnFaceUp on Defined$ Self", () => {
    const game = mkGame();
    const seat0 = mkPlayerSeat(0);
    const sourceId = mkEntityId(10);

    const card = new Card(sourceId, plainPaper, seat0, seat0, ZoneType.Battlefield);
    card.faceDown = { kind: "morph" };
    game.cards.set(sourceId, card);
    game.getPlayer(seat0).zones.get(ZoneType.Battlefield)?.add(sourceId);

    const turnFaceUpSpy = vi.spyOn(game.action, "turnFaceUp");

    const sa = new SpellAbility(mkAst("TurnFaceUp"), sourceId, seat0, new Map(), []);
    drainGen(sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>);

    expect(turnFaceUpSpy).toHaveBeenCalledWith(sourceId);
  });

  it("unknown Mode$ throws an error", () => {
    const game = mkGame();
    const seat0 = mkPlayerSeat(0);
    const sourceId = mkEntityId(10);

    const card = new Card(sourceId, plainPaper, seat0, seat0, ZoneType.Battlefield);
    game.cards.set(sourceId, card);

    const sa = new SpellAbility(mkAst("UnknownMode"), sourceId, seat0, new Map(), []);
    expect(() => drainGen(sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>)).toThrow(
      /unknown Mode\$/,
    );
  });
});
