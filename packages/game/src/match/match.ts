// SPDX-License-Identifier: GPL-3.0-or-later
// Match — the best-of-N series wrapper around individual Games. Tracks per-seat
// score across games, remembers which seat conceded last game (so SP2's
// sideboarding flow can surface the signal), and decides when the series has a
// winner. Games themselves live on the Match via currentGame; SP2's MatchSetup
// swaps them in/out as games start and end.
//
// MatchController here is the match-scoped decide-interface (sideboard /
// concedeMatch / acceptDrawOffer) — the mirror of PlayerController but at a
// strictly coarser granularity (runs for a whole best-of-N, not per-game).
import type {
  Deck,
  LobbyPlayer,
  MatchDecisionRequest,
  MatchDecisionResponse,
  PlayerSeat,
} from "@mtg-forge-ts/core";
import { mkPlayerSeat } from "@mtg-forge-ts/core";
import type { EngineYield } from "../action/engine-yield.js";
import type { Game } from "../game.js";

/**
 * Match-scoped controller contract. Invoked by SP2's match-flow driver for the
 * three MatchDecisionRequest kinds (sideboard, concedeMatch, acceptDrawOffer).
 * Separate from PlayerController because match-level decisions persist across
 * game resets (sideboard state survives between games; per-game hand/mulligan
 * decisions don't).
 */
export interface MatchController {
  decide(req: MatchDecisionRequest): MatchDecisionResponse;
}

/**
 * Per-seat running score for a match. `concededLastGame` is per-seat because
 * SP2's sideboarding UI shows the losing side which option the loser took
 * (concede vs play-to-finish) as a quality-of-life signal.
 */
export interface MatchScore {
  readonly wins: number;
  readonly gamesPlayed: number;
  readonly concededLastGame: boolean;
}

/**
 * Result of a single Game within the Match. `winners` is a set (array) because
 * team play can have multiple seats share a win, and draws emit an empty array.
 */
export interface MatchGameResult {
  readonly gameIndex: number;
  readonly winners: readonly PlayerSeat[];
  readonly reason: "victory" | "draw" | "concede" | "timeout";
}

/**
 * Construction-time parameters for a Match. `players[i]` and `decks[i]` are
 * index-aligned; the constructor throws if the two lengths diverge.
 */
export interface MatchOptions {
  readonly bestOf: 1 | 3 | 5;
  readonly players: readonly LobbyPlayer[];
  readonly decks: readonly Deck[];
  readonly formatId: string;
}

export class Match {
  readonly options: MatchOptions;
  private readonly scores: Map<PlayerSeat, MatchScore>;
  private readonly games: MatchGameResult[] = [];
  private currentGame: Game | null = null;

  constructor(options: MatchOptions) {
    if (options.players.length !== options.decks.length) {
      throw new Error(
        `Match: player count (${options.players.length}) must match deck count (${options.decks.length})`,
      );
    }
    this.options = options;
    this.scores = new Map();
    for (let i = 0; i < options.players.length; i++) {
      this.scores.set(mkPlayerSeat(i), {
        wins: 0,
        gamesPlayed: 0,
        concededLastGame: false,
      });
    }
  }

  getScore(seat: PlayerSeat): MatchScore {
    const s = this.scores.get(seat);
    if (!s) throw new Error(`Match: no score for seat ${seat as unknown as number}`);
    return s;
  }

  getGames(): readonly MatchGameResult[] {
    return this.games;
  }

  getCurrentGame(): Game | null {
    return this.currentGame;
  }

  setCurrentGame(game: Game | null): void {
    this.currentGame = game;
  }

  /**
   * Record a finished game's outcome. Winners get wins+1; non-winners only
   * increment gamesPlayed. `reasonConceded` lets SP2 mark the losing seat's
   * concededLastGame flag so the between-games sideboard UI can surface it
   * (e.g., an "AI conceded" banner).
   */
  recordGameResult(result: MatchGameResult, reasonConceded = false): void {
    this.games.push(result);
    const winners = new Set<PlayerSeat>(result.winners);
    for (const [seat, s] of this.scores) {
      if (winners.has(seat)) {
        this.scores.set(seat, {
          wins: s.wins + 1,
          gamesPlayed: s.gamesPlayed + 1,
          // Winners reset the concede flag — it only tracks last-game losers.
          concededLastGame: false,
        });
      } else {
        this.scores.set(seat, {
          wins: s.wins,
          gamesPlayed: s.gamesPlayed + 1,
          concededLastGame: reasonConceded && result.reason === "concede",
        });
      }
    }
  }

  /**
   * Match is decided once a seat has the majority needed to win (ceil(bestOf/2))
   * or every game has been played. The all-games-played branch covers the
   * 1-1-draw / 1-1-1 ties the wins-based check would miss.
   */
  isDecided(): boolean {
    const winsToWin = Math.ceil(this.options.bestOf / 2);
    for (const s of this.scores.values()) {
      if (s.wins >= winsToWin) return true;
    }
    return this.games.length >= this.options.bestOf;
  }

  /**
   * Between-games sideboarding generator. SP2 will yield a sideboard
   * MatchDecisionRequest per seat, collect responses, and mutate the
   * MatchOptions.decks to the newly-chosen configuration. SP1 stubs the flow
   * so consumers can wire the contract now.
   */
  // biome-ignore lint/correctness/useYield: stub throws before any yield
  *sideboardingFlow(): Generator<EngineYield, void, MatchDecisionResponse> {
    throw new Error("Match.sideboardingFlow: SP2 sideboarding flow required");
  }
}
