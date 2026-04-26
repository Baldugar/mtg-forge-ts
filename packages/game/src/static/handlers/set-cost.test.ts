// SPDX-License-Identifier: GPL-3.0-or-later
// Wave 11 — SetCostHandler unit tests.
import type { LobbyPlayer, ParamValue, StaticAst } from "@mtg-forge-ts/core";
import { SeededRng, ZoneType, mkEntityId, mkPlayerSeat } from "@mtg-forge-ts/core";
import { describe, expect, it } from "vitest";
import type { GameMeta } from "../../game-meta.js";
import type { GameRules } from "../../game-rules.js";
import { Game } from "../../game.js";
import type { CostModEffect } from "../../statics/cost-mod-contributor.js";
import { staticHandlerRegistry } from "../static-handler.js";
import { SetCostHandler } from "./set-cost.js";

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
const makeGame = (): Game => new Game({ lobbyPlayers: [alice, bob], rules, meta, rng: new SeededRng(1n) });
const lit = (raw: string): ParamValue => ({ kind: "literal", raw });

describe("SetCostHandler (Wave 11 / Gap 5)", () => {
  it("registers itself with staticHandlerRegistry", () => {
    expect(staticHandlerRegistry.lookup("SetCost")).toBe(SetCostHandler);
  });

  it("build() emits a costModification StaticAbility with mode=SetCost", () => {
    const game = makeGame();
    const handler = new SetCostHandler();
    const ast: StaticAst = {
      mode: "SetCost",
      params: { ValidCard: lit("Card"), Type: lit("Spell"), Amount: lit("3") },
      activeInZones: [ZoneType.Battlefield],
    };
    const built = handler.build(ast, {
      game,
      sourceCardId: mkEntityId(1),
      controllerSeat: mkPlayerSeat(0),
      staticId: mkEntityId(2),
    });
    expect(built.kind).toBe("static");
    expect(built.category).toBe("costModification");
    expect(built.mode).toBe("SetCost");
  });

  it("describe() yields an effect whose filter records setMinTotal during evaluation", () => {
    const game = makeGame();
    const handler = new SetCostHandler();
    const ast: StaticAst = {
      mode: "SetCost",
      params: { ValidCard: lit("Card"), Type: lit("Spell"), Amount: lit("3") },
      activeInZones: [ZoneType.Battlefield],
    };
    const built = handler.build(ast, {
      game,
      sourceCardId: mkEntityId(1),
      controllerSeat: mkPlayerSeat(0),
      staticId: mkEntityId(2),
    });
    const effect = built.describe() as CostModEffect;
    // Run filter on a well-shaped item so amountResolver fires; setMinTotal
    // should reflect the resolved Amount$.
    const item = {
      sourceCardId: mkEntityId(50),
      controllerSeat: mkPlayerSeat(0),
      card: undefined,
      kind: "spell" as const,
    };
    const matched = effect.filter(item, game);
    expect(matched).toBe(true);
    expect(effect.setMinTotal).toBe(3);
  });
});
