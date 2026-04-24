// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from "vitest";
import type { Game } from "../../game.js";
import type { SvarContext } from "../context.js";
import { evaluateExpression } from "../evaluator.js";
import "./player-count.js";

const mkGame = (playerCount: number): Game =>
  ({
    players: Array.from({ length: playerCount }, (_, i) => ({ life: 20, seat: i })),
  }) as unknown as Game;

const mkCtx = (playerCount: number): SvarContext => ({
  game: mkGame(playerCount),
  svars: new Map(),
});

describe("PlayerCount$ selector", () => {
  it("returns total players for All scope (3 players)", () => {
    expect(
      evaluateExpression(
        { kind: "PlayerCount", raw: "PlayerCount$All", args: [{ kind: "literal", raw: "All" }] },
        mkCtx(3),
      ),
    ).toBe(3);
  });

  it("returns 1 for You scope", () => {
    expect(
      evaluateExpression(
        { kind: "PlayerCount", raw: "PlayerCount$You", args: [{ kind: "literal", raw: "You" }] },
        mkCtx(3),
      ),
    ).toBe(1);
  });

  it("returns (total - 1) for Opponents scope (3 players)", () => {
    expect(
      evaluateExpression(
        { kind: "PlayerCount", raw: "PlayerCount$Opponents", args: [{ kind: "literal", raw: "Opponents" }] },
        mkCtx(3),
      ),
    ).toBe(2);
  });
});
