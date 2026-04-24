// SPDX-License-Identifier: GPL-3.0-or-later
// Ensure svar selectors are registered.
import "../../svar/selectors/number.js";
// Import effects — each self-registers in effectRegistry at module load.
import "./gain-life.js";
import "./lose-life.js";
import type { LobbyPlayer, PaperCard } from "@mtg-forge-ts/core";
import { DEFAULT_PAPER_CARD_FLAGS, SeededRng, ZoneType, mkEntityId, mkPlayerSeat } from "@mtg-forge-ts/core";
import { describe, expect, it } from "vitest";
import { Card } from "../../card.js";
import type { GameMeta } from "../../game-meta.js";
import type { GameRules } from "../../game-rules.js";
import { Game } from "../../game.js";
import { Battlefield } from "../../zone/zones/battlefield.js";
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
    player.zones.set(ZoneType.Battlefield, new Battlefield(ZoneType.Battlefield, player.seat));
  }
  return game;
};

const drainGen = (gen: Generator<unknown, void, unknown>): void => {
  let r = gen.next();
  while (!r.done) r = gen.next();
};

describe("GainLifeEffect", () => {
  it("Healing Salve — controller gains 3 life (life total increases by 3)", () => {
    const game = mkGame();
    const seat0 = mkPlayerSeat(0);
    const sourceId = mkEntityId(1);
    const source = new Card(sourceId, paper, seat0, seat0, ZoneType.Battlefield);
    game.cards.set(sourceId, source);

    const before = game.getPlayer(seat0).life;

    const sa = new SpellAbility(
      {
        kind: "spell",
        effect: {
          handlerKey: "GainLife",
          params: { LifeAmount: { kind: "literal", raw: "3" } },
        },
        cost: { raw: "W" },
      },
      sourceId,
      seat0,
      new Map(),
    );

    drainGen(sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>);
    expect(game.getPlayer(seat0).life).toBe(before + 3);
  });
});

describe("LoseLifeEffect", () => {
  it("controller loses 2 life (life total decreases by 2)", () => {
    const game = mkGame();
    const seat0 = mkPlayerSeat(0);
    const sourceId = mkEntityId(1);
    const source = new Card(sourceId, paper, seat0, seat0, ZoneType.Battlefield);
    game.cards.set(sourceId, source);

    const before = game.getPlayer(seat0).life;

    const sa = new SpellAbility(
      {
        kind: "spell",
        effect: {
          handlerKey: "LoseLife",
          params: { LifeAmount: { kind: "literal", raw: "2" } },
        },
        cost: { raw: "B" },
      },
      sourceId,
      seat0,
      new Map(),
    );

    drainGen(sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>);
    expect(game.getPlayer(seat0).life).toBe(before - 2);
  });
});
