// SPDX-License-Identifier: GPL-3.0-or-later
// Match — the best-of-N series wrapper around individual Games. Tracks per-seat
// score across games, remembers which seat conceded last game (so SP2's
// sideboarding flow can surface the signal), and decides when the series has a
// winner. Games themselves live on the Match via currentGame; SP2's MatchSetup
// swaps them in/out as games start and end.
//
// MatchController (match-scoped decide-interface for sideboard /
// concedeMatch / acceptDrawOffer) lives in packages/game/src/controller so
// PlayerController + MatchController share one import path; Match re-exports
// the type here for backwards compatibility with Task 41's consumer surface.
//
// Match.run() — SP1 post-audit addition. Spec §15 defines Match.run as the
// generator that loops games until the match is decided. SP1 supports Bo1
// and Bo3/Bo5 without sideboarding (auto-continue with the same decks
// between games). The sideboard MatchDecisionRequest yield belongs to SP7
// (limited / sideboard tooling) and is stubbed in sideboardingFlow().
import type {
  DecisionResponse,
  Deck,
  LobbyPlayer,
  MatchDecisionResponse,
  PlayerSeat,
} from "@mtg-forge-ts/core";
import { GameStateIntegrityError, mkPlayerSeat } from "@mtg-forge-ts/core";
import type { EngineYield } from "../action/engine-yield.js";
import type { MatchController, PlayerController } from "../controller/controller.js";
import type { Game } from "../game.js";
import { runGame } from "../run-game.js";
import type { SetupDecks } from "../setup/setup-flow.js";

export type { MatchController };

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
  /**
   * Optional MatchController for SP7 sideboard / draw-offer / concede-match
   * handling. SP1 does not require one — Match.run auto-continues between
   * games. Stored on the Match so future flows can reach it uniformly.
   */
  readonly matchController?: MatchController;
}

/**
 * Overall match outcome returned by Match.run() when the series is decided.
 * `winner` is null on a draw (all games ended in draws or tied at the cap);
 * `reason` records how the match ended so observers can distinguish a
 * victory from a matchController-concede even when the score looks the same.
 */
export interface MatchOutcome {
  readonly winner: PlayerSeat | null;
  readonly reason: "victory" | "draw" | "concede";
  readonly games: readonly MatchGameResult[];
}

/**
 * Factory produced by the caller for Match.run. Each call to
 * `setupGameFactory()` mints the per-game Game instance, the SetupDecks
 * mapping, and the per-seat PlayerController map. Separating factory from
 * Match keeps Match ignorant of Game construction (SP4 CardDb + PaperCard
 * wiring) while still letting run() cycle games.
 */
export interface MatchGameSetup {
  readonly game: Game;
  readonly decks: SetupDecks;
  readonly controllers: Map<PlayerSeat, PlayerController>;
}
export type MatchGameFactory = (gameIndex: number) => MatchGameSetup;

export class Match {
  readonly options: MatchOptions;
  private readonly scores: Map<PlayerSeat, MatchScore>;
  private readonly games: MatchGameResult[] = [];
  private currentGame: Game | null = null;
  /**
   * MatchController — optional reference hoisted from MatchOptions so SP7's
   * sideboardingFlow and concedeMatch paths can reach it without re-plumbing.
   * Null when the caller doesn't supply one (the SP1 default).
   */
  readonly matchController: MatchController | null;

  constructor(options: MatchOptions) {
    if (options.players.length !== options.decks.length) {
      // WHY: construction-time structural mismatch — this is a game-state
      // integrity error, not an InvalidDeckError (which is reserved for
      // deck-legality failures like CR format-legality).
      throw new GameStateIntegrityError(
        `Match: player count (${options.players.length}) must match deck count (${options.decks.length})`,
      );
    }
    this.options = options;
    this.matchController = options.matchController ?? null;
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
    if (!s) {
      throw new GameStateIntegrityError(`Match: no score for seat ${seat as unknown as number}`);
    }
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
   * Between-games sideboarding generator. SP7 will yield a sideboard
   * MatchDecisionRequest per seat, collect responses, and mutate the
   * MatchOptions.decks to the newly-chosen configuration. SP1 stubs the flow
   * so consumers can wire the contract now.
   */
  // biome-ignore lint/correctness/useYield: stub throws before any yield
  *sideboardingFlow(): Generator<EngineYield, void, MatchDecisionResponse> {
    throw new Error("Match.sideboardingFlow: SP7 sideboarding flow required");
  }

  /**
   * Match.run — top-level match generator. Loops until isDecided():
   *   1. Invoke `setupGameFactory(gameIndex)` to build the next Game + decks
   *      + per-seat PlayerControllers.
   *   2. Run the Game to terminal state via runGame(), forwarding every
   *      engine yield. Decision yields are answered from the seat-keyed
   *      controller map (matches the integration smoke test's driver shape).
   *   3. Derive a MatchGameResult from game.terminalState and recordGameResult.
   *   4. If the match isn't yet decided, loop to game index + 1. SP7 will
   *      insert a sideboard MatchDecisionRequest yield here; SP1 auto-continues.
   *
   * Returns a MatchOutcome describing the final series result.
   *
   * SP1 scope: Bo1 and Bo3/Bo5 without sideboarding. Full sideboard decision
   * yield belongs to SP7 (limited / sideboard tooling).
   */
  *run(setupGameFactory: MatchGameFactory): Generator<EngineYield, MatchOutcome, DecisionResponse> {
    let gameIndex = 0;
    // WHY: hard cap prevents a malformed factory from producing an unbounded
    // loop. bestOf is 1/3/5; even with a draw streak the series must decide
    // by bestOf games. +1 buys a safety margin for concede-as-draw edge cases.
    const maxGames = this.options.bestOf + 1;

    while (!this.isDecided()) {
      if (gameIndex >= maxGames) {
        throw new GameStateIntegrityError(
          `Match.run: exceeded maxGames (${maxGames}) without reaching a decided state`,
        );
      }
      const { game, decks, controllers } = setupGameFactory(gameIndex);
      this.setCurrentGame(game);

      // Drive the per-game generator. runGame yields events + decisions; we
      // forward events upstream unchanged, and answer decisions by routing
      // each request's playerSeat to the matching PlayerController.
      const gen = runGame(game, { decks });
      let step = gen.next();
      while (!step.done) {
        const y = step.value;
        if (y.kind === "event") {
          yield y;
          step = gen.next();
          continue;
        }
        // Decision yield — route by playerSeat. Every SP1 DecisionRequest
        // carries a playerSeat; narrow structurally rather than enumerating
        // all 44 kinds.
        const req = y.request;
        if (!("playerSeat" in req)) {
          throw new GameStateIntegrityError(
            `Match.run: unexpected DecisionRequest without playerSeat (kind=${req.kind})`,
          );
        }
        const controller = controllers.get(req.playerSeat);
        if (!controller) {
          throw new GameStateIntegrityError(
            `Match.run: no controller for seat ${req.playerSeat as unknown as number} (game ${gameIndex})`,
          );
        }
        const response = controller.decide(req);
        step = gen.next(response);
      }

      // Record the result. Derive winners + reason from terminalState.
      const result = deriveGameResult(game, gameIndex);
      const concededByLoser = result.reason === "concede";
      this.recordGameResult(result, concededByLoser);
      gameIndex++;
    }

    this.setCurrentGame(null);
    return this.computeOverallOutcome();
  }

  /**
   * Derive the MatchOutcome from the current score ledger. Called at the end
   * of run(); SP7 can also invoke directly after a concedeMatch.
   */
  computeOverallOutcome(): MatchOutcome {
    if (!this.isDecided()) {
      throw new GameStateIntegrityError("Match.computeOverallOutcome: called on an undecided match");
    }
    const winsToWin = Math.ceil(this.options.bestOf / 2);
    let topSeat: PlayerSeat | null = null;
    let topWins = -1;
    let tieAtTop = false;
    for (const [seat, s] of this.scores) {
      if (s.wins > topWins) {
        topWins = s.wins;
        topSeat = seat;
        tieAtTop = false;
      } else if (s.wins === topWins) {
        tieAtTop = true;
      }
    }
    if (topSeat === null || tieAtTop || topWins < winsToWin) {
      // Tied at the cap or no seat reached majority — match is a draw.
      return { winner: null, reason: "draw", games: [...this.games] };
    }
    // WHY: even on a clean win, surface "concede" if the decisive game ended
    // via concession. Observers rendering "Alice wins by concede" need this.
    const lastConcede = this.games.some((g) => g.reason === "concede" && g.winners.includes(topSeat));
    return {
      winner: topSeat,
      reason: lastConcede ? "concede" : "victory",
      games: [...this.games],
    };
  }
}

/**
 * Map a finished Game's terminalState into a MatchGameResult. Runs once per
 * game at the end of Match.run's inner loop. Throws if terminalState is
 * still null — the caller is expected to run the game to completion before
 * calling this.
 */
const deriveGameResult = (game: Game, gameIndex: number): MatchGameResult => {
  const ts = game.terminalState;
  if (ts === null) {
    throw new GameStateIntegrityError(`Match.run: game ${gameIndex} ended without a terminalState`);
  }
  // WHY: narrow the discriminated union once into a local binding so each
  // branch's fields (winner / teamId) are type-resolvable. A ternary chain
  // that re-dereferences ts.outcome loses the narrowing across arms.
  let winners: PlayerSeat[];
  const outcome = ts.outcome;
  if (outcome.kind === "win") {
    winners = [outcome.winner];
  } else if (outcome.kind === "teamWin") {
    // Team wins: all seats on the winning team count as winners.
    winners = game.players.filter((p) => p.teamId === outcome.teamId).map((p) => p.seat);
  } else {
    // Draw — no winners.
    winners = [];
  }
  // Reason mapping: if any seat conceded this game, surface "concede" so the
  // Match-level concededLastGame flag is set correctly.
  const reason: MatchGameResult["reason"] =
    ts.concededSeats.length > 0 ? "concede" : outcome.kind === "draw" ? "draw" : "victory";
  return { gameIndex, winners, reason };
};
