// SPDX-License-Identifier: GPL-3.0-or-later
// Tests for CharmEffect — modal spell dispatcher.
import "../../svar/selectors/number.js";
// Self-registering side effects.
import "./charm.js";
import "./gain-life.js";
import "./lose-life.js";
import "./draw.js";
import type { DecisionResponse, LobbyPlayer, PaperCard, SVarAst } from "@mtg-forge-ts/core";
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

/**
 * Drive a generator to completion, replying to any "chooseModes" decision
 * with the given modeIds array.
 */
const drainWithModes = (gen: Generator<unknown, void, unknown>, modeIds: readonly string[]): void => {
  let r = gen.next();
  while (!r.done) {
    const y = r.value as { kind?: string; request?: { kind?: string } } | undefined;
    if (y?.kind === "decision" && y.request && (y.request as { kind?: string }).kind === "chooseModes") {
      const resp: DecisionResponse = { kind: "chooseModes", modeIds };
      r = gen.next(resp);
    } else {
      r = gen.next();
    }
  }
};

// Drain fully — no decision reply (uses deterministic fallback).
const drainGen = (gen: Generator<unknown, void, unknown>): void => {
  let r = gen.next();
  while (!r.done) r = gen.next();
};

describe("CharmEffect", () => {
  it("resolves the chosen mode — GainLife mode runs, LoseLife mode does not", () => {
    const game = mkGame();
    const seat0 = mkPlayerSeat(0);
    const sourceId = mkEntityId(10);

    game.cards.set(sourceId, new Card(sourceId, paper, seat0, seat0, ZoneType.Battlefield));

    // Two sub-modes: DBGainLife (gain 3) and DBLoseLife (lose 3).
    // Charm picks 1 of the 2.
    const gainSvar: SVarAst = {
      kind: "ability",
      raw: "DB$ GainLife | LifeAmount$ 3",
      ability: {
        handlerKey: "GainLife",
        params: { LifeAmount: { kind: "literal", raw: "3" } },
      },
    };
    const loseSvar: SVarAst = {
      kind: "ability",
      raw: "DB$ LoseLife | LifeAmount$ 3",
      ability: {
        handlerKey: "LoseLife",
        params: { LifeAmount: { kind: "literal", raw: "3" } },
      },
    };
    const svars = new Map<string, SVarAst>([
      ["DBGainLife", gainSvar],
      ["DBLoseLife", loseSvar],
    ]);

    const sa = new SpellAbility(
      {
        kind: "spell",
        effect: {
          handlerKey: "Charm",
          params: {
            Choices: { kind: "literal", raw: "DBGainLife,DBLoseLife" },
            CharmNum: { kind: "literal", raw: "1" },
          },
        },
        cost: { raw: "1 R" },
      },
      sourceId,
      seat0,
      svars,
    );

    const lifeBefore = game.getPlayer(seat0).life;
    // Choose only DBGainLife — life should increase by 3, not decrease.
    drainWithModes(sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>, ["DBGainLife"]);

    expect(game.getPlayer(seat0).life).toBe(lifeBefore + 3);
  });

  it("fallback: first CharmNum mode runs when no decision driver", () => {
    const game = mkGame();
    const seat0 = mkPlayerSeat(0);
    const sourceId = mkEntityId(10);

    game.cards.set(sourceId, new Card(sourceId, paper, seat0, seat0, ZoneType.Battlefield));

    const gainSvar: SVarAst = {
      kind: "ability",
      raw: "DB$ GainLife | LifeAmount$ 5",
      ability: {
        handlerKey: "GainLife",
        params: { LifeAmount: { kind: "literal", raw: "5" } },
      },
    };
    const loseSvar: SVarAst = {
      kind: "ability",
      raw: "DB$ LoseLife | LifeAmount$ 5",
      ability: {
        handlerKey: "LoseLife",
        params: { LifeAmount: { kind: "literal", raw: "5" } },
      },
    };
    const svars = new Map<string, SVarAst>([
      ["DBGainLife", gainSvar],
      ["DBLoseLife", loseSvar],
    ]);

    const sa = new SpellAbility(
      {
        kind: "spell",
        effect: {
          handlerKey: "Charm",
          params: {
            Choices: { kind: "literal", raw: "DBGainLife,DBLoseLife" },
            CharmNum: { kind: "literal", raw: "1" },
          },
        },
        cost: { raw: "1 R" },
      },
      sourceId,
      seat0,
      svars,
    );

    const lifeBefore = game.getPlayer(seat0).life;
    // No mode reply → deterministic fallback picks DBGainLife (first in list).
    drainGen(sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>);

    // First mode is GainLife, so life increases.
    expect(game.getPlayer(seat0).life).toBe(lifeBefore + 5);
  });

  it("default CharmNum is 1 when param is absent", () => {
    const game = mkGame();
    const seat0 = mkPlayerSeat(0);
    const sourceId = mkEntityId(10);

    game.cards.set(sourceId, new Card(sourceId, paper, seat0, seat0, ZoneType.Battlefield));

    const gainSvar: SVarAst = {
      kind: "ability",
      raw: "DB$ GainLife | LifeAmount$ 2",
      ability: {
        handlerKey: "GainLife",
        params: { LifeAmount: { kind: "literal", raw: "2" } },
      },
    };
    const svars = new Map<string, SVarAst>([["DBGain", gainSvar]]);

    // No CharmNum$ param — should default to 1 and pick DBGain.
    const sa = new SpellAbility(
      {
        kind: "spell",
        effect: {
          handlerKey: "Charm",
          params: {
            Choices: { kind: "literal", raw: "DBGain" },
          },
        },
        cost: { raw: "1 G" },
      },
      sourceId,
      seat0,
      svars,
    );

    const lifeBefore = game.getPlayer(seat0).life;
    drainGen(sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>);
    expect(game.getPlayer(seat0).life).toBe(lifeBefore + 2);
  });
});
