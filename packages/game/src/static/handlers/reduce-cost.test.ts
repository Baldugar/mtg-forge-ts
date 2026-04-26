// SPDX-License-Identifier: GPL-3.0-or-later
// Wave 6 — ReduceCost / RaiseCost handler tests. Verifies build() produces
// a costModification StaticAbility with the right delta and a working filter.
import type { LobbyPlayer, ParamValue, StaticAst } from "@mtg-forge-ts/core";
import { SeededRng, ZoneType, mkEntityId, mkPlayerSeat } from "@mtg-forge-ts/core";
import { describe, expect, it } from "vitest";
import type { GameMeta } from "../../game-meta.js";
import type { GameRules } from "../../game-rules.js";
import { Game } from "../../game.js";
import type { CostModEffect } from "../../statics/cost-mod-contributor.js";
import { staticHandlerRegistry } from "../static-handler.js";
import { RaiseCostHandler } from "./raise-cost.js";
import { ReduceCostHandler } from "./reduce-cost.js";

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

describe("ReduceCostHandler (Wave 6)", () => {
  it("registers itself with staticHandlerRegistry", () => {
    expect(staticHandlerRegistry.lookup("ReduceCost")).toBe(ReduceCostHandler);
  });

  it("build() emits a costModification StaticAbility with negative generic delta", () => {
    const game = makeGame();
    const handler = new ReduceCostHandler();
    const ast: StaticAst = {
      mode: "ReduceCost",
      params: { ValidCard: lit("Card.Black"), Type: lit("Spell"), Amount: lit("1") },
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
    expect(built.mode).toBe("ReduceCost");
    expect(built.activeInZones.has(ZoneType.Battlefield)).toBe(true);
    const effect = built.describe() as CostModEffect;
    // Wave 11: delta.generic is now a function (lazy resolution). Invoke it
    // to obtain the numeric delta — the literal "1" resolves to -1.
    expect(typeof effect.delta.generic).toBe("function");
    const fn = effect.delta.generic as (item: unknown, game: import("../../game.js").Game) => number;
    expect(fn({}, game)).toBe(-1);
    expect(effect.sourceStaticId).toBe(mkEntityId(2));
  });

  it("defaults activeInZones to Battlefield when AST omits it", () => {
    const game = makeGame();
    const handler = new ReduceCostHandler();
    const ast: StaticAst = {
      mode: "ReduceCost",
      params: { Amount: lit("1") },
      activeInZones: [],
    };
    const built = handler.build(ast, {
      game,
      sourceCardId: mkEntityId(1),
      controllerSeat: mkPlayerSeat(0),
      staticId: mkEntityId(2),
    });
    expect(built.activeInZones.has(ZoneType.Battlefield)).toBe(true);
  });

  it("Wave 11 — accepts non-numeric Amount$ (SVar/Count exprs); resolves at apply time", () => {
    const game = makeGame();
    const handler = new ReduceCostHandler();
    const ast: StaticAst = {
      mode: "ReduceCost",
      params: { Amount: { kind: "svarRef", name: "X" } },
      activeInZones: [ZoneType.Battlefield],
    };
    // Should NOT throw at build time — even when no SVar table exists, the
    // resolver swallows evaluation errors at apply time and returns 0.
    const built = handler.build(ast, {
      game,
      sourceCardId: mkEntityId(1),
      controllerSeat: mkPlayerSeat(0),
      staticId: mkEntityId(2),
    });
    const effect = built.describe() as CostModEffect;
    // Dynamic delta — function form. With no resolvable X, returns 0 (cost-mod inert).
    expect(typeof effect.delta.generic).toBe("function");
  });
});

describe("RaiseCostHandler (Wave 6)", () => {
  it("registers itself with staticHandlerRegistry", () => {
    expect(staticHandlerRegistry.lookup("RaiseCost")).toBe(RaiseCostHandler);
  });

  it("build() emits a costModification StaticAbility with positive generic delta", () => {
    const game = makeGame();
    const handler = new RaiseCostHandler();
    const ast: StaticAst = {
      mode: "RaiseCost",
      params: { ValidCard: lit("Spell"), Activator: lit("Opponent"), Amount: lit("2") },
      activeInZones: [ZoneType.Battlefield],
    };
    const built = handler.build(ast, {
      game,
      sourceCardId: mkEntityId(1),
      controllerSeat: mkPlayerSeat(0),
      staticId: mkEntityId(3),
    });
    expect(built.mode).toBe("RaiseCost");
    expect(built.category).toBe("costModification");
    const effect = built.describe() as CostModEffect;
    expect(typeof effect.delta.generic).toBe("function");
    const fn = effect.delta.generic as (item: unknown, game: import("../../game.js").Game) => number;
    expect(fn({}, game)).toBe(2);
  });
});
