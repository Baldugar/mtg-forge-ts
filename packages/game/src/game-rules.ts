// SPDX-License-Identifier: GPL-3.0-or-later
// Immutable per-Game rules: format + starting parameters + mulligan variant +
// rule-override keys + player-count bounds + Forge-aligned variant/match
// fields. teamAssignments maps seat -> team; omit for free-for-all where each
// seat is its own team (Game constructor assigns teamId = seat in that case).
//
// Field parity against Forge's forge.game.GameRules.java:
//   - manaBurn, poisonCountersToLose, playForAnte, gamesPerMatch/-ToWinMatch,
//     appliedVariants (Set<GameType>) are carried verbatim.
//   - gameType is represented by `formatId` (string) + `appliedVariants`
//     (GameVariant[]) so SP6 can map the string id onto a structured
//     format definition without this type depending on it.

/**
 * Forge's GameType enum, restricted to the subset that behaves as an
 * applied variant layered on top of a format (rather than an alternative
 * match driver). Matches Forge's `GameRules.appliedVariants` usage at
 * forge-game/src/main/java/forge/game/GameRules.java.
 *
 * Add a new variant here when Forge adds one; consumers must enumerate
 * them exhaustively in their rule logic.
 */
export type GameVariant =
  | "Commander"
  | "Oathbreaker"
  | "TinyLeaders"
  | "Brawl"
  | "Conspiracy"
  | "Planechase"
  | "Vanguard"
  | "Archenemy"
  | "ArchenemyRumble"
  | "TwoHeadedGiant"
  | "EmperorDuel"
  | "MomirBasic"
  | "MoJhoSto"
  | "Planeswalker";

export interface GameRules {
  readonly formatId: string;
  readonly startingLife: number;
  readonly startingHandSize: number;
  readonly mulliganRule: "london" | "vancouver" | "paris" | "free";
  readonly firstPlayerSkipsDraw: boolean;
  readonly ruleOverrides: readonly string[];
  readonly playerCount: { readonly min: number; readonly max: number };
  readonly teamAssignments?: readonly number[];
  /**
   * Forge's GameRules.poisonCountersToLose. Modern default is 10; 2HG bumps
   * to 15. Must be a positive integer (engine validates at Game construction
   * time — SP2 ties the SBA check to this number).
   */
  readonly poisonCountersToLose: number;
  /**
   * Forge's GameRules.playForAnte. Default false. When true, setup moves
   * one random library card to the Ante zone before opening hands are drawn.
   */
  readonly playForAnte: boolean;
  /**
   * Forge's GameRules.manaBurn. Default false for modern rules. Pre-M10
   * (mana-burn era) games set it true; SP2's end-of-phase cleanup reads this.
   */
  readonly manaBurn: boolean;
  /**
   * Match length — Forge's GameRules.gamesPerMatch (default 3 = Bo3). Omit
   * for single-game exhibitions; Match drives Bo3/Bo5 sequencing off this.
   */
  readonly gamesPerMatch?: number;
  /**
   * Games needed to win the match (Forge derives this as
   * `gamesPerMatch / 2 + 1`; we require the host to state it explicitly so
   * no-best-of-1 edge cases round predictably).
   */
  readonly gamesToWinMatch?: number;
  /**
   * Forge's GameRules.appliedVariants. Empty for vanilla constructed. A
   * Commander pod = ["Commander"]; a Planechase-over-Commander pod =
   * ["Commander", "Planechase"]. Order-insensitive in Forge; we use readonly
   * array to keep round-trips deterministic.
   */
  readonly appliedVariants: readonly GameVariant[];
}
