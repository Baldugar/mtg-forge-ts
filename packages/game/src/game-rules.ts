// SPDX-License-Identifier: GPL-3.0-or-later
// Immutable per-Game rules: format + starting parameters + mulligan variant +
// rule-override keys + player-count bounds. teamAssignments maps seat → team;
// omit for free-for-all where each seat is its own team (Game constructor
// assigns teamId = seat in that case).
export interface GameRules {
  readonly formatId: string;
  readonly startingLife: number;
  readonly startingHandSize: number;
  readonly mulliganRule: "london" | "vancouver" | "paris" | "free";
  readonly firstPlayerSkipsDraw: boolean;
  readonly ruleOverrides: readonly string[];
  readonly playerCount: { readonly min: number; readonly max: number };
  readonly teamAssignments?: readonly number[];
}
