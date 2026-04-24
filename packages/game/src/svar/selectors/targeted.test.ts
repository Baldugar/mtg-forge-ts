import type { EntityId } from "@mtg-forge-ts/core";
// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from "vitest";
import type { Game } from "../../game.js";
import type { SvarContext } from "../context.js";
import { evaluateExpression } from "../evaluator.js";
import "./targeted.js";

const mkCtx = (targets?: readonly EntityId[]): SvarContext => ({
  game: {} as unknown as Game,
  svars: new Map(),
  ...(targets !== undefined ? { targets } : {}),
});

describe("Targeted$ selector", () => {
  it("returns target at valid index 0", () => {
    const target = 42 as unknown as EntityId;
    const ctx = mkCtx([target]);
    expect(
      evaluateExpression({ kind: "Targeted", raw: "Targeted$0", args: [{ kind: "literal", raw: "0" }] }, ctx),
    ).toBe(42);
  });

  it("throws when index is out of range", () => {
    const ctx = mkCtx([1 as unknown as EntityId]);
    expect(() =>
      evaluateExpression({ kind: "Targeted", raw: "Targeted$1", args: [{ kind: "literal", raw: "1" }] }, ctx),
    ).toThrow(/no target at index/);
  });

  it("throws when no targets in context", () => {
    const ctx = mkCtx(undefined);
    expect(() =>
      evaluateExpression({ kind: "Targeted", raw: "Targeted$0", args: [{ kind: "literal", raw: "0" }] }, ctx),
    ).toThrow(/no target at index/);
  });
});
