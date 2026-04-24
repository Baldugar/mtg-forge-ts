import type { PlayerSeat } from "@mtg-forge-ts/core";
// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from "vitest";
import type { Game } from "../../game.js";
import type { SvarContext } from "../context.js";
import { evaluateExpression } from "../evaluator.js";
import "./life-total.js";

const mkGame = (lives: number[]): Game =>
  ({
    getPlayer: (seat: PlayerSeat) => ({ life: lives[seat as unknown as number] }),
  }) as unknown as Game;

const mkCtx = (overrides: Partial<SvarContext> = {}): SvarContext => ({
  game: mkGame([20, 15]),
  svars: new Map(),
  ...overrides,
});

describe("LifeTotal$ selector", () => {
  it("returns controller life for 'You' scope", () => {
    const ctx = mkCtx({ controller: 0 as PlayerSeat });
    expect(
      evaluateExpression(
        { kind: "LifeTotal", raw: "LifeTotal$You", args: [{ kind: "literal", raw: "You" }] },
        ctx,
      ),
    ).toBe(20);
  });

  it("returns opponent life for 'Opponent' scope", () => {
    const ctx = mkCtx({ controller: 0 as PlayerSeat });
    expect(
      evaluateExpression(
        { kind: "LifeTotal", raw: "LifeTotal$Opponent", args: [{ kind: "literal", raw: "Opponent" }] },
        ctx,
      ),
    ).toBe(15);
  });

  it("throws on unsupported scope", () => {
    const ctx = mkCtx({ controller: 0 as PlayerSeat });
    expect(() =>
      evaluateExpression(
        { kind: "LifeTotal", raw: "LifeTotal$All", args: [{ kind: "literal", raw: "All" }] },
        ctx,
      ),
    ).toThrow(/unsupported scope/);
  });
});
