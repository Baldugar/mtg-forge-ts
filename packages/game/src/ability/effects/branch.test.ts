// SPDX-License-Identifier: GPL-3.0-or-later
// Wave 3 — BranchEffect condition evaluation tests.
// Verifies that Branch evaluates BranchConditionSVar$ and picks the correct branch.
import "./branch.js";
import type { LobbyPlayer, PaperCard, SVarAst } from "@mtg-forge-ts/core";
import { DEFAULT_PAPER_CARD_FLAGS, SeededRng, ZoneType, mkEntityId, mkPlayerSeat } from "@mtg-forge-ts/core";
import { describe, expect, it, vi } from "vitest";
import type { EngineYield } from "../../action/engine-yield.js";
import { Card } from "../../card.js";
import type { GameMeta } from "../../game-meta.js";
import type { GameRules } from "../../game-rules.js";
import { Game } from "../../game.js";
import { Battlefield } from "../../zone/zones/battlefield.js";
import { Graveyard } from "../../zone/zones/graveyard.js";
import { Hand } from "../../zone/zones/hand.js";
import { Library } from "../../zone/zones/library.js";
import { effectRegistry } from "../effect-registry.js";
import { SpellAbilityEffect } from "../spell-ability-effect.js";
import type { SpellAbility } from "../spell-ability.js";
import { SpellAbility as SpellAbilityClass } from "../spell-ability.js";

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

const drainGen = (gen: Generator<unknown, void, unknown>): EngineYield[] => {
  const yields: EngineYield[] = [];
  let r = gen.next();
  while (!r.done) {
    yields.push(r.value as EngineYield);
    r = gen.next();
  }
  return yields;
};

/**
 * Build a mock effect that records calls. Returns the class and a spy.
 */
const mkMockEffect = (key: string) => {
  const spy = vi.fn();
  class MockEffect extends SpellAbilityEffect {
    static override readonly handlerKey = key;
    // biome-ignore lint/correctness/useYield: mock effect records calls without yielding
    override *resolve(sa: SpellAbility, _game: Game): Generator<EngineYield, void, unknown> {
      spy(sa.handlerKey);
    }
  }
  effectRegistry.register(MockEffect);
  return { spy, MockEffect };
};

describe("BranchEffect — condition evaluation (Wave 3)", () => {
  it("condition '1' (truthy) runs TrueSubAbility", () => {
    const { spy: trueSpy } = mkMockEffect("BranchTrue_T1");
    const { spy: falseSpy } = mkMockEffect("BranchFalse_T1");

    const game = mkGame();
    const seat0 = mkPlayerSeat(0);
    const sourceId = mkEntityId(10);
    game.cards.set(sourceId, new Card(sourceId, paper, seat0, seat0, ZoneType.Battlefield));

    const svars = new Map<string, SVarAst>([
      ["CondVar", { kind: "value", raw: "1" }],
      [
        "DBTrue",
        { kind: "ability", raw: "BranchTrue_T1", ability: { handlerKey: "BranchTrue_T1", params: {} } },
      ],
      [
        "DBFalse",
        { kind: "ability", raw: "BranchFalse_T1", ability: { handlerKey: "BranchFalse_T1", params: {} } },
      ],
    ]);

    const sa = new SpellAbilityClass(
      {
        kind: "spell",
        effect: {
          handlerKey: "Branch",
          params: {
            BranchConditionSVar: { kind: "literal", raw: "CondVar" },
            TrueSubAbility: { kind: "literal", raw: "DBTrue" },
            FalseSubAbility: { kind: "literal", raw: "DBFalse" },
          },
        },
        cost: { raw: "" },
      },
      sourceId,
      seat0,
      svars,
      [],
    );

    drainGen(sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>);
    expect(trueSpy).toHaveBeenCalledOnce();
    expect(falseSpy).not.toHaveBeenCalled();
  });

  it("condition '0' (falsy) runs FalseSubAbility", () => {
    const { spy: trueSpy } = mkMockEffect("BranchTrue_T2");
    const { spy: falseSpy } = mkMockEffect("BranchFalse_T2");

    const game = mkGame();
    const seat0 = mkPlayerSeat(0);
    const sourceId = mkEntityId(10);
    game.cards.set(sourceId, new Card(sourceId, paper, seat0, seat0, ZoneType.Battlefield));

    const svars = new Map<string, SVarAst>([
      ["CondVar", { kind: "value", raw: "0" }],
      [
        "DBTrue",
        { kind: "ability", raw: "BranchTrue_T2", ability: { handlerKey: "BranchTrue_T2", params: {} } },
      ],
      [
        "DBFalse",
        { kind: "ability", raw: "BranchFalse_T2", ability: { handlerKey: "BranchFalse_T2", params: {} } },
      ],
    ]);

    const sa = new SpellAbilityClass(
      {
        kind: "spell",
        effect: {
          handlerKey: "Branch",
          params: {
            BranchConditionSVar: { kind: "literal", raw: "CondVar" },
            TrueSubAbility: { kind: "literal", raw: "DBTrue" },
            FalseSubAbility: { kind: "literal", raw: "DBFalse" },
          },
        },
        cost: { raw: "" },
      },
      sourceId,
      seat0,
      svars,
      [],
    );

    drainGen(sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>);
    expect(falseSpy).toHaveBeenCalledOnce();
    expect(trueSpy).not.toHaveBeenCalled();
  });

  it("no condition → unconditionally runs TrueSubAbility", () => {
    const { spy: trueSpy } = mkMockEffect("BranchTrue_T3");

    const game = mkGame();
    const seat0 = mkPlayerSeat(0);
    const sourceId = mkEntityId(10);
    game.cards.set(sourceId, new Card(sourceId, paper, seat0, seat0, ZoneType.Battlefield));

    const svars = new Map<string, SVarAst>([
      [
        "DBTrue",
        { kind: "ability", raw: "BranchTrue_T3", ability: { handlerKey: "BranchTrue_T3", params: {} } },
      ],
    ]);

    const sa = new SpellAbilityClass(
      {
        kind: "spell",
        effect: {
          handlerKey: "Branch",
          params: {
            TrueSubAbility: { kind: "literal", raw: "DBTrue" },
          },
        },
        cost: { raw: "" },
      },
      sourceId,
      seat0,
      svars,
      [],
    );

    drainGen(sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>);
    expect(trueSpy).toHaveBeenCalledOnce();
  });
});
