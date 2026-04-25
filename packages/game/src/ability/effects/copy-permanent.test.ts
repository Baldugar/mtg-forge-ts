// SPDX-License-Identifier: GPL-3.0-or-later
import "./copy-permanent.js";
import "../../svar/selectors/number.js";
import type { AbilityAst, LobbyPlayer, PaperCard } from "@mtg-forge-ts/core";
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
const makePaper = (name: string): PaperCard => ({
  name,
  edition: "LEA",
  collectorNumber: "001",
  language: "en",
  foil: false,
  flags: DEFAULT_PAPER_CARD_FLAGS,
});

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

const mkAst = (numCopies?: number): AbilityAst => ({
  kind: "spell",
  effect: {
    handlerKey: "CopyPermanent",
    params: {
      ...(numCopies !== undefined ? { NumCopies: { kind: "literal", raw: String(numCopies) } } : {}),
    },
  },
  cost: { raw: "" },
});

describe("CopyPermanentEffect", () => {
  it("creates a token copy of the target creature with the same paperCard", () => {
    const game = mkGame();
    const seat0 = mkPlayerSeat(0);
    const seat1 = mkPlayerSeat(1);
    const sourceId = mkEntityId(10);
    const targetId = mkEntityId(20);

    const targetPaper = makePaper("Clone Target");
    const source = new Card(sourceId, makePaper("Cloner"), seat0, seat0, ZoneType.Battlefield);
    const target = new Card(targetId, targetPaper, seat1, seat1, ZoneType.Battlefield);
    game.cards.set(sourceId, source);
    game.cards.set(targetId, target);

    const cardsBefore = game.cards.size;

    const sa = new SpellAbility(mkAst(1), sourceId, seat0, new Map(), [targetId]);
    drainGen(sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>);

    // One new token should have been created.
    expect(game.cards.size).toBe(cardsBefore + 1);

    // Find the new card — it's the one that's a token.
    const newTokens = [...game.cards.values()].filter((c) => c.isToken);
    expect(newTokens).toHaveLength(1);
    const token = newTokens[0];
    expect(token).toBeDefined();
    // Token has the same paperCard as the original target.
    expect(token?.paperCard.name).toBe("Clone Target");
    // Token is controlled by the caster.
    expect(token?.controllerSeat).toBe(seat0);
  });

  it("defaults to 1 copy when NumCopies$ is absent", () => {
    const game = mkGame();
    const seat0 = mkPlayerSeat(0);
    const sourceId = mkEntityId(10);
    const targetId = mkEntityId(20);

    game.cards.set(sourceId, new Card(sourceId, makePaper("Cloner"), seat0, seat0, ZoneType.Battlefield));
    game.cards.set(targetId, new Card(targetId, makePaper("Target"), seat0, seat0, ZoneType.Battlefield));

    const cardsBefore = game.cards.size;
    const sa = new SpellAbility(mkAst(), sourceId, seat0, new Map(), [targetId]);
    drainGen(sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>);

    expect(game.cards.size).toBe(cardsBefore + 1);
  });

  it("creates NumCopies$ token copies when specified", () => {
    const game = mkGame();
    const seat0 = mkPlayerSeat(0);
    const sourceId = mkEntityId(10);
    const targetId = mkEntityId(20);

    game.cards.set(sourceId, new Card(sourceId, makePaper("Cloner"), seat0, seat0, ZoneType.Battlefield));
    game.cards.set(targetId, new Card(targetId, makePaper("Target"), seat0, seat0, ZoneType.Battlefield));

    const cardsBefore = game.cards.size;
    const sa = new SpellAbility(mkAst(3), sourceId, seat0, new Map(), [targetId]);
    drainGen(sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>);

    expect(game.cards.size).toBe(cardsBefore + 3);
  });
});
