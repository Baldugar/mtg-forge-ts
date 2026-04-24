// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from "vitest";
import type { Game } from "../../game.js";
import type { SvarContext } from "../context.js";
import { evaluateExpression } from "../evaluator.js";
import "./arithmetic.js";

const mkCtx = (): SvarContext => ({
  game: {} as unknown as Game,
  svars: new Map(),
});

const lit = (raw: string) => ({ kind: "literal" as const, raw });

describe("Arithmetic selectors", () => {
  it("Add: sums all literal args", () => {
    expect(evaluateExpression({ kind: "Add", raw: "Add$3,4", args: [lit("3"), lit("4")] }, mkCtx())).toBe(7);
  });

  it("Sub: subtracts second from first", () => {
    expect(evaluateExpression({ kind: "Sub", raw: "Sub$10,3", args: [lit("10"), lit("3")] }, mkCtx())).toBe(
      7,
    );
  });

  it("Mul: multiplies all literal args", () => {
    expect(evaluateExpression({ kind: "Mul", raw: "Mul$3,4", args: [lit("3"), lit("4")] }, mkCtx())).toBe(12);
  });

  it("Div: truncates toward zero", () => {
    expect(evaluateExpression({ kind: "Div", raw: "Div$7,2", args: [lit("7"), lit("2")] }, mkCtx())).toBe(3);
  });

  it("Mod: returns remainder", () => {
    expect(evaluateExpression({ kind: "Mod", raw: "Mod$10,3", args: [lit("10"), lit("3")] }, mkCtx())).toBe(
      1,
    );
  });

  it("Min: returns minimum of args", () => {
    expect(
      evaluateExpression({ kind: "Min", raw: "Min$5,2,8", args: [lit("5"), lit("2"), lit("8")] }, mkCtx()),
    ).toBe(2);
  });

  it("Max: returns maximum of args", () => {
    expect(
      evaluateExpression({ kind: "Max", raw: "Max$5,2,8", args: [lit("5"), lit("2"), lit("8")] }, mkCtx()),
    ).toBe(8);
  });

  it("Negate: negates the arg", () => {
    expect(evaluateExpression({ kind: "Negate", raw: "Negate$5", args: [lit("5")] }, mkCtx())).toBe(-5);
  });

  it("Abs: returns absolute value", () => {
    expect(evaluateExpression({ kind: "Abs", raw: "Abs$-3", args: [lit("-3")] }, mkCtx())).toBe(3);
  });
});
