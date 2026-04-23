// SPDX-License-Identifier: GPL-3.0-or-later
// ManaCostSolver — future home of the pool-vs-cost satisfiability check
// (including alt-cost interactions, hybrid/phyrexian routing, and
// restriction filtering). SP1 ships the signature so callers in
// PhaseHandler/GameAction can reference the solver; the real search
// algorithm belongs to SP3 alongside the Cost AST completion.
import type { Cost } from "@mtg-forge-ts/core";
import type { Game } from "../game.js";
import type { Player } from "../player.js";

export class ManaCostSolver {
  canPay(_cost: Cost, _player: Player, _game: Game): boolean {
    throw new Error("ManaCostSolver.canPay: SP3 implementation required");
  }
}
