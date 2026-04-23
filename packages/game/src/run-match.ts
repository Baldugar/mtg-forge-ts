// SPDX-License-Identifier: GPL-3.0-or-later
// runMatch — top-level match driver. Thin wrapper around Match.run() that
// mirrors runGame's contract one level up. Consumers who need a suspendable
// generator over a full best-of-N series use this; consumers who just want a
// single game use runGame directly.
//
// The setup factory pattern mirrors Match.run: the caller provides a function
// that mints the per-game Game instance + decks + controllers. This keeps
// Match and runMatch ignorant of Game construction (SP4 CardDb + PaperCard
// wiring lives on the caller side).
import type { DecisionResponse } from "@mtg-forge-ts/core";
import type { EngineYield } from "./action/engine-yield.js";
import type { Match, MatchGameFactory, MatchOutcome } from "./match/match.js";

export function* runMatch(
  match: Match,
  factory: MatchGameFactory,
): Generator<EngineYield, MatchOutcome, DecisionResponse> {
  return yield* match.run(factory);
}
