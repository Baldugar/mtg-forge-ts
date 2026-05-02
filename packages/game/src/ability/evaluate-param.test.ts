// SPDX-License-Identifier: GPL-3.0-or-later
// Ensure selectors are registered before tests run.
import "../svar/selectors/number.js";
import "../svar/selectors/x-choice.js";
import type { AbilityAst, LobbyPlayer } from "@mtg-forge-ts/core";
import { SeededRng, mkEntityId, mkPlayerSeat } from "@mtg-forge-ts/core";
import { describe, expect, it } from "vitest";
import type { GameMeta } from "../game-meta.js";
import type { GameRules } from "../game-rules.js";
import { Game } from "../game.js";
import { evaluateParamNumber, evaluateParamRaw } from "./evaluate-param.js";
import { SpellAbility } from "./spell-ability.js";

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
const mkGame = () => new Game({ lobbyPlayers: [alice, bob], rules, meta, rng: new SeededRng(1n) });

const mkAst = (params: AbilityAst["effect"]["params"]): AbilityAst => ({
  kind: "spell",
  effect: { handlerKey: "TestEffect", params },
  cost: { raw: "" },
});

describe("evaluateParamNumber", () => {
  it("evaluates a literal integer param", () => {
    const ast = mkAst({ NumDmg: { kind: "literal", raw: "3" } });
    const sa = new SpellAbility(ast, mkEntityId(1), mkPlayerSeat(0), new Map());
    const game = mkGame();
    expect(evaluateParamNumber(sa, "NumDmg", game)).toBe(3);
  });

  it("evaluates an X expression param using xValue", () => {
    // expression: Number$X — the X selector reads from ctx.xValue
    const ast = mkAst({
      NumDmg: {
        kind: "expression",
        ast: { kind: "X", raw: "X" },
      },
    });
    const sa = new SpellAbility(ast, mkEntityId(1), mkPlayerSeat(0), new Map(), [], 2);
    const game = mkGame();
    expect(evaluateParamNumber(sa, "NumDmg", game)).toBe(2);
  });

  it("throws when the param key is missing", () => {
    const ast = mkAst({});
    const sa = new SpellAbility(ast, mkEntityId(1), mkPlayerSeat(0), new Map());
    const game = mkGame();
    expect(() => evaluateParamNumber(sa, "NumDmg", game)).toThrow("no param 'NumDmg'");
  });
});

describe("evaluateParamRaw", () => {
  it("returns the raw string for a literal param", () => {
    const ast = mkAst({ ValidTgts: { kind: "literal", raw: "Creature.YouCtrl" } });
    const sa = new SpellAbility(ast, mkEntityId(1), mkPlayerSeat(0), new Map());
    expect(evaluateParamRaw(sa, "ValidTgts")).toBe("Creature.YouCtrl");
  });

  it("returns the SVar reference name for a svarRef param (M6.16)", () => {
    // M6.16 — RepeatSubAbility$ DBReveal / SubAbility$ DBFoo / AbilityName$ X
    // params arrive as `svarRef`; evaluateParamRaw returns the bare name so
    // callers can look the SVar up themselves.
    const ast = mkAst({ RepeatSubAbility: { kind: "svarRef", name: "DBReveal" } });
    const sa = new SpellAbility(ast, mkEntityId(1), mkPlayerSeat(0), new Map());
    expect(evaluateParamRaw(sa, "RepeatSubAbility")).toBe("DBReveal");
  });

  it("returns the raw expression text for an expression param (M6.16)", () => {
    // Some Forge params (NumCards$ -X / NumAtt$ X+1) classify as expression
    // when the parser detects the `$` form. evaluateParamRaw exposes the
    // printed form so consumers (PumpAll's NumDef "-X") can do their own
    // arithmetic without re-running classifyParamValue.
    const ast = mkAst({ NumDmg: { kind: "expression", ast: { kind: "X", raw: "X-1" } } });
    const sa = new SpellAbility(ast, mkEntityId(1), mkPlayerSeat(0), new Map());
    expect(evaluateParamRaw(sa, "NumDmg")).toBe("X-1");
  });

  it("throws when the param key is missing", () => {
    const ast = mkAst({});
    const sa = new SpellAbility(ast, mkEntityId(1), mkPlayerSeat(0), new Map());
    expect(() => evaluateParamRaw(sa, "ValidTgts")).toThrow("no param 'ValidTgts'");
  });
});
