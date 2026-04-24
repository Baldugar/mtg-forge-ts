// SPDX-License-Identifier: GPL-3.0-or-later
import { Color, ManaCost, ManaProduced } from "@mtg-forge-ts/core";
import { describe, expect, it } from "vitest";
import { ManaCostBeingPaid } from "./mana-cost-being-paid.js";

describe("ManaCostBeingPaid", () => {
  it("one R pip, consume R mana → isPaid", () => {
    const cost = ManaCost.parse("R");
    const tracker = new ManaCostBeingPaid(cost.symbols);
    expect(tracker.isPaid()).toBe(false);
    tracker.consume(ManaProduced.colored(Color.Red));
    expect(tracker.isPaid()).toBe(true);
  });

  it("1R = generic + colored pips; tracker picks first matching pip (generic first)", () => {
    // "1R" expands to [generic{1}, colored{Red}].
    // When consuming Red mana, findIndex hits generic{1} at index 0 first
    // (generic is satisfied by any mana). The tracker itself does NOT sort —
    // the solver is responsible for ordering pips before calling consume.
    // This test documents the raw tracker behavior (first-match).
    const cost = ManaCost.parse("1R");
    const tracker = new ManaCostBeingPaid(cost.symbols);
    expect(tracker.remainingPips()).toHaveLength(2);

    // Consuming Red mana matches generic first → colored pip remains.
    tracker.consume(ManaProduced.colored(Color.Red));
    expect(tracker.remainingPips()).toHaveLength(1);
    const remaining = tracker.remainingPips();
    expect(remaining[0]?.kind).toBe("colored"); // colored{Red} still unpaid
  });

  it("W/U hybrid, consume W pays", () => {
    const cost = ManaCost.parse("W/U");
    const tracker = new ManaCostBeingPaid(cost.symbols);
    tracker.consume(ManaProduced.colored(Color.White));
    expect(tracker.isPaid()).toBe(true);
  });

  it("W/U hybrid, consume U pays", () => {
    const cost = ManaCost.parse("W/U");
    const tracker = new ManaCostBeingPaid(cost.symbols);
    tracker.consume(ManaProduced.colored(Color.Blue));
    expect(tracker.isPaid()).toBe(true);
  });

  it("W/U hybrid, consume B throws (no match)", () => {
    const cost = ManaCost.parse("W/U");
    const tracker = new ManaCostBeingPaid(cost.symbols);
    expect(() => tracker.consume(ManaProduced.colored(Color.Black))).toThrow(/no remaining pip/);
  });

  it("canConsume returns false when cost paid", () => {
    const cost = ManaCost.parse("R");
    const tracker = new ManaCostBeingPaid(cost.symbols);
    tracker.consume(ManaProduced.colored(Color.Red));
    expect(tracker.isPaid()).toBe(true);
    expect(tracker.canConsume(ManaProduced.colored(Color.Red))).toBe(false);
  });

  it("remainingPips reflects consume sequence with correct pip ordering", () => {
    // "2WU" expands to [generic{1}, generic{1}, colored{White}, colored{Blue}].
    // Consume White: matches generic{1} at index 0 first → one generic gone.
    // Consume Blue: matches remaining generic{1} at index 0 → second generic gone.
    // Two colored pips (W and U) remain.
    // Consume White directly into colored{White} → now only colored{Blue} left.
    // Consume Blue → done.
    const cost = ManaCost.parse("2WU");
    const tracker = new ManaCostBeingPaid(cost.symbols);
    expect(tracker.remainingPips()).toHaveLength(4);

    tracker.consume(ManaProduced.colored(Color.White)); // hits generic[0]
    tracker.consume(ManaProduced.colored(Color.Blue)); // hits generic[1]
    expect(tracker.remainingPips()).toHaveLength(2);
    // Remaining: [colored{White}, colored{Blue}]
    expect(tracker.remainingPips()[0]?.kind).toBe("colored");
    expect(tracker.remainingPips()[1]?.kind).toBe("colored");

    tracker.consume(ManaProduced.colored(Color.White)); // hits colored{White}
    tracker.consume(ManaProduced.colored(Color.Blue)); // hits colored{Blue}
    expect(tracker.isPaid()).toBe(true);
  });

  it("variable pip bound to xValue expands to that many generic pips", () => {
    const cost = ManaCost.parse("X");
    const tracker = new ManaCostBeingPaid(cost.symbols, 3);
    expect(tracker.remainingPips()).toHaveLength(3);
    tracker.consume(ManaProduced.colored(Color.Red));
    tracker.consume(ManaProduced.colored(Color.Green));
    tracker.consume(ManaProduced.colored(Color.Blue));
    expect(tracker.isPaid()).toBe(true);
  });

  it("colorless pip satisfied by colorless mana only", () => {
    const cost = ManaCost.parse("C");
    const tracker = new ManaCostBeingPaid(cost.symbols);
    // Colored mana does NOT satisfy a colorless pip
    expect(tracker.canConsume(ManaProduced.colored(Color.Red))).toBe(false);
    // Truly colorless mana does
    expect(tracker.canConsume(ManaProduced.colorless())).toBe(true);
    tracker.consume(ManaProduced.colorless());
    expect(tracker.isPaid()).toBe(true);
  });

  it("snow pip satisfied by snow mana", () => {
    const cost = ManaCost.parse("S");
    const tracker = new ManaCostBeingPaid(cost.symbols);
    expect(tracker.canConsume(ManaProduced.colored(Color.Red))).toBe(false);
    const snowMana = ManaProduced.snow(Color.Red);
    expect(tracker.canConsume(snowMana)).toBe(true);
    tracker.consume(snowMana);
    expect(tracker.isPaid()).toBe(true);
  });
});
