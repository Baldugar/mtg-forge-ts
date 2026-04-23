// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from "vitest";
import {
  AiTimeBudgetExceededError,
  DecisionLogCorruptError,
  DeckContainsUnknownCardError,
  ForgeError,
  GameStateIntegrityError,
  IllegalCastError,
  IllegalDecisionError,
  IncompatibleCacheFormatError,
  IncompatibleCardDataError,
  IncompatibleSnapshotVersionError,
  InvalidDeckError,
  ManaParseError,
  ParseError,
  SnapshotRestoreError,
  UnknownAiProfileError,
  UnknownCardError,
  UnknownFormatError,
  UnknownHandlerError,
  UnregisteredRuleOverrideError,
} from "./errors.js";

describe("ForgeError hierarchy", () => {
  it("UnknownCardError carries cardName, sets .name, formats message", () => {
    const e = new UnknownCardError("Foo");
    expect(e.cardName).toBe("Foo");
    expect(e.name).toBe("UnknownCardError");
    expect(e.message).toBe("Unknown card: Foo");
    expect(e).toBeInstanceOf(UnknownCardError);
    expect(e).toBeInstanceOf(ForgeError);
    expect(e).toBeInstanceOf(Error);
  });

  it("UnknownHandlerError carries handlerKey, sets .name, formats message", () => {
    const e = new UnknownHandlerError("ETB_DRAW");
    expect(e.handlerKey).toBe("ETB_DRAW");
    expect(e.name).toBe("UnknownHandlerError");
    expect(e.message).toBe("Unknown handler: ETB_DRAW");
    expect(e).toBeInstanceOf(ForgeError);
  });

  it("ParseError accepts optional location", () => {
    const e1 = new ParseError("no location");
    expect(e1.location).toBeUndefined();
    expect(e1.name).toBe("ParseError");

    const e2 = new ParseError("with loc", { file: "a.txt", line: 3, column: 7 });
    expect(e2.location).toEqual({ file: "a.txt", line: 3, column: 7 });
    expect(e2).toBeInstanceOf(ForgeError);
  });

  it("ManaParseError is a ParseError and a ForgeError and an Error", () => {
    const e = new ManaParseError("bad mana");
    expect(e).toBeInstanceOf(ManaParseError);
    expect(e).toBeInstanceOf(ParseError);
    expect(e).toBeInstanceOf(ForgeError);
    expect(e).toBeInstanceOf(Error);
    expect(e.name).toBe("ManaParseError");
    expect(e.message).toBe("bad mana");
    expect(e.location).toBeUndefined();
  });

  it("ManaParseError forwards location through ParseError ctor", () => {
    const e = new ManaParseError("bad", { file: "cost.ts", line: 1, column: 2 });
    expect(e.location).toEqual({ file: "cost.ts", line: 1, column: 2 });
  });

  it("DeckContainsUnknownCardError joins names into message and stores array", () => {
    const e = new DeckContainsUnknownCardError(["A", "B", "C"]);
    expect(e.names).toEqual(["A", "B", "C"]);
    expect(e.message).toBe("Deck contains unknown cards: A, B, C");
    expect(e.name).toBe("DeckContainsUnknownCardError");
  });

  it("InvalidDeckError carries issues array", () => {
    const issues = [{ rule: "min", actual: 58, required: 60 }];
    const e = new InvalidDeckError("deck too small", issues);
    expect(e.issues).toBe(issues);
    expect(e.message).toBe("deck too small");
    expect(e.name).toBe("InvalidDeckError");
  });

  it("IllegalDecisionError carries optional legalOptions", () => {
    const e1 = new IllegalDecisionError("bad");
    expect(e1.legalOptions).toBeUndefined();
    expect(e1.name).toBe("IllegalDecisionError");

    const e2 = new IllegalDecisionError("bad", [1, 2, 3]);
    expect(e2.legalOptions).toEqual([1, 2, 3]);
  });

  it("bare-subclass ForgeError types inherit (message) ctor and set .name", () => {
    const cases: Array<[new (m: string) => ForgeError, string]> = [
      [IncompatibleCardDataError, "IncompatibleCardDataError"],
      [IncompatibleCacheFormatError, "IncompatibleCacheFormatError"],
      [IncompatibleSnapshotVersionError, "IncompatibleSnapshotVersionError"],
      [UnknownFormatError, "UnknownFormatError"],
      [UnregisteredRuleOverrideError, "UnregisteredRuleOverrideError"],
      [GameStateIntegrityError, "GameStateIntegrityError"],
      [IllegalCastError, "IllegalCastError"],
      [SnapshotRestoreError, "SnapshotRestoreError"],
      [DecisionLogCorruptError, "DecisionLogCorruptError"],
      [UnknownAiProfileError, "UnknownAiProfileError"],
      [AiTimeBudgetExceededError, "AiTimeBudgetExceededError"],
    ];
    for (const [Ctor, expectedName] of cases) {
      const e = new Ctor("msg");
      expect(e.message).toBe("msg");
      expect(e.name).toBe(expectedName);
      expect(e).toBeInstanceOf(ForgeError);
      expect(e).toBeInstanceOf(Error);
    }
  });

  it("every concrete subclass is instanceof ForgeError and Error", () => {
    const instances: Error[] = [
      new UnknownCardError("x"),
      new UnknownHandlerError("x"),
      new ParseError("x"),
      new ManaParseError("x"),
      new IncompatibleCardDataError("x"),
      new IncompatibleCacheFormatError("x"),
      new IncompatibleSnapshotVersionError("x"),
      new InvalidDeckError("x", []),
      new DeckContainsUnknownCardError(["x"]),
      new UnknownFormatError("x"),
      new UnregisteredRuleOverrideError("x"),
      new GameStateIntegrityError("x"),
      new IllegalDecisionError("x"),
      new IllegalCastError("x"),
      new SnapshotRestoreError("x"),
      new DecisionLogCorruptError("x"),
      new UnknownAiProfileError("x"),
      new AiTimeBudgetExceededError("x"),
    ];
    for (const e of instances) {
      expect(e).toBeInstanceOf(ForgeError);
      expect(e).toBeInstanceOf(Error);
    }
  });

  it("errors carry a .stack (V8 default) for debugging", () => {
    const e = new UnknownCardError("x");
    // WHY: .stack is non-standard but present on V8 / Node; verify it is set
    // so the hierarchy doesn't accidentally lose stack traces.
    expect(typeof e.stack).toBe("string");
    expect((e.stack ?? "").length).toBeGreaterThan(0);
  });
});
