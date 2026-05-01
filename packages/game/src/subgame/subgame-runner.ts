// SPDX-License-Identifier: GPL-3.0-or-later
// Wave 116 — Subgame full nested-game runtime (Shahrazad / CR 723).
//
// Replaces Wave 44's deterministic-score MVP. SubgameRunner builds a child
// Game instance that mirrors the parent's lobby + rules + per-player
// libraries, then drives an autonomous priority-loop with RandomLegalController
// answering every decision. The subgame runs to terminal state (one player
// remaining) or a bounded-turn fallback. Either way, the parent gets:
//   - the subgame's winner / losers (used to credit the parent-game life
//     loss the loser absorbs — half the loser's parent life, rounded up);
//   - SubgameStarted + SubgameResolved events emitted from the parent's
//     event pipe so trigger observers + replay logs see the pulse.
//
// Why a separate module (and not inlined in SubgameEffect): the runner needs
// to import `Game`, `runPriorityWindow`, `RandomLegalController`, `endGame`,
// and the zone constructors. Pulling those into wave-21-effects.ts would
// inflate that file substantially and add a `Game→effects→Game` cycle. A
// dedicated subgame/ directory keeps the subgame plumbing self-contained
// and lets future SP-waves swap in a richer driver (full setupFlow, real
// AI controller, mulligan honoring) without touching the effect handler.
//
// Bounded-turn fallback: a real Shahrazad subgame can theoretically loop
// forever (mill loops, non-terminating triggers). We cap the number of
// priority windows to MAX_PRIORITY_WINDOWS. On exhaustion the runner falls
// back to Wave 44's deterministic score-based outcome so the parent gets
// a definitive answer. The cap is intentionally generous (10000 windows;
// each turn ~ a few dozen windows in steady-state) so well-formed games
// reach their natural terminal state in-budget.

import type { DecisionResponse, LobbyPlayer, PaperCard, PlayerSeat, Rng } from "@mtg-forge-ts/core";
import { SeededRng, ZoneType, mkEntityId, mkEvent } from "@mtg-forge-ts/core";
import type { EngineYield } from "../action/engine-yield.js";
import { Card } from "../card.js";
import { RandomLegalController } from "../controller/random-legal-controller.js";
import { endGame } from "../end/end-game.js";
import type { Game } from "../game.js";
import { PhaseHandler } from "../phase/phase-handler.js";
import type { TerminalOutcome } from "../terminal-state.js";
import { Battlefield } from "../zone/zones/battlefield.js";
import { Exile } from "../zone/zones/exile.js";
import { Graveyard } from "../zone/zones/graveyard.js";
import { Hand } from "../zone/zones/hand.js";
import { Library } from "../zone/zones/library.js";

// WHY bounded: even with random-legal play the engine pumps through a
// decision per priority window. A typical mid-complexity game converges
// in well under a few hundred yields; 50k is the panic-stop ceiling on
// total engine yields. Above this the runner falls back to the score-
// based outcome to guarantee a finite SubgameResolved event for the
// parent. We count YIELDS, not turns or priority windows, because
// random-legal play can spam priority within a single step (multiple
// SBA sweeps with no terminal).
const MAX_ENGINE_YIELDS = 50_000;
// Secondary turn-cap so a degenerate "neither player can lose" subgame
// also exits cleanly. Real MTG always terminates within a few dozen
// turns under random play (libraries deplete at ~1 card/turn each), but
// we keep the cap loose at 200 so well-formed subgames have headroom.
const MAX_SUBGAME_TURNS = 200;

export interface SubgameOutcome {
  /** The seat that won the subgame, or null if every player drew/timeout. */
  readonly winnerSeat: PlayerSeat | null;
  /** Every other player loses; this is their roster. */
  readonly loserSeats: readonly PlayerSeat[];
  /**
   * `true` if the subgame reached its natural terminal state inside the
   * priority-window budget. `false` means we hit MAX_PRIORITY_WINDOWS and
   * fell back to the deterministic score-based tiebreak.
   */
  readonly reachedTerminal: boolean;
  /** Number of priority windows actually consumed. */
  readonly windowsConsumed: number;
}

/**
 * Build a child Game that mirrors `parent` — same lobby roster, same rules
 * + meta, but a freshly-forked RNG so the parent's RNG state isn't
 * advanced by subgame draws. Each player's library in the subgame is a
 * minted copy of the parent's library (each card gets a fresh entityId in
 * the child registry; the parent's cards are untouched). Hand / graveyard /
 * battlefield / exile zones start empty — Shahrazad explicitly says
 * "using their libraries as their decks", so battlefields, hands, etc.
 * don't carry over. CR 723 (Shahrazad) is silent on graveyard carry-over;
 * we treat it as "fresh subgame, fresh state" for simplicity.
 *
 * The subgame's life totals start at the parent's `rules.startingLife`
 * (CR 723: subgame is "a Magic subgame" — players start at the format
 * starting life total).
 */
export const buildSubgameFromParent = (parent: Game): Game => {
  // Lazy import so wave-21-effects.ts doesn't incur a Game cycle through
  // SubgameRunner at module load.
  // biome-ignore lint/suspicious/noExplicitAny: deliberate dynamic import to break the Game→effects cycle
  const GameCtor: any = parent.constructor;
  const lobbyPlayers: LobbyPlayer[] = parent.players.map((p) => p.lobbyPlayer);

  // Fork RNG: derive a child seed from the parent's current state. Calling
  // parent.rng.nextInt advances the parent's stream, which is intentional —
  // it preserves replay determinism (the parent's "next call" is now after
  // the subgame's seed draw) without leaking parent rolls into the
  // subgame's stream. We pull two 32-bit ints and shift to assemble a
  // bigint seed.
  const seedHi = BigInt(parent.rng.nextInt(0, 0x7fffffff));
  const seedLo = BigInt(parent.rng.nextInt(0, 0x7fffffff));
  const childSeed = (seedHi << 32n) | seedLo;
  const childRng: Rng = new SeededRng(childSeed);

  const child: Game = new GameCtor({
    lobbyPlayers,
    rules: parent.rules,
    meta: parent.meta,
    rng: childRng,
  }) as Game;

  // Seed each player's zones. Library entries become fresh Card instances
  // (new EntityIds, ownership / control matching the seat). PaperCard refs
  // are shared with the parent — they're immutable definition data so it's
  // safe to alias them.
  for (let i = 0; i < parent.players.length; i++) {
    const parentPlayer = parent.players[i];
    const childPlayer = child.players[i];
    if (!parentPlayer || !childPlayer) continue;

    // Fresh zone set. Parent zones may have stale per-card state; a clean
    // subgame board keeps the runner's invariants simple.
    childPlayer.zones.set(ZoneType.Library, new Library(ZoneType.Library, childPlayer.seat));
    childPlayer.zones.set(ZoneType.Hand, new Hand(ZoneType.Hand, childPlayer.seat));
    childPlayer.zones.set(ZoneType.Graveyard, new Graveyard(ZoneType.Graveyard, childPlayer.seat));
    childPlayer.zones.set(ZoneType.Battlefield, new Battlefield(ZoneType.Battlefield, childPlayer.seat));
    childPlayer.zones.set(ZoneType.Exile, new Exile(ZoneType.Exile, childPlayer.seat));

    // Copy the library: clone parent library's cards into the child registry
    // with fresh entityIds. Order is preserved (top of library → top in child).
    const parentLibrary = parentPlayer.zones.get(ZoneType.Library);
    if (parentLibrary) {
      const childLibrary = childPlayer.zones.get(ZoneType.Library);
      if (childLibrary) {
        for (const parentCardId of parentLibrary.toArray()) {
          const parentCard = parent.cards.get(parentCardId);
          if (!parentCard) continue;
          // Mint a fresh card in the child registry. The PaperCard is shared
          // (immutable definition data); ownership + controller match the
          // child seat; zone is the child library.
          const newId = child.newEntityId();
          const childCard = new Card(
            newId,
            parentCard.paperCard as PaperCard,
            childPlayer.seat,
            childPlayer.seat,
            ZoneType.Library,
          );
          child.cards.set(newId, childCard);
          childLibrary.add(newId);
        }
      }
    }
  }

  return child;
};

/**
 * Run the subgame to terminal state OR until the priority-window budget is
 * exhausted. Returns the subgame outcome — the caller (SubgameEffect)
 * applies the parent-side life consequence.
 *
 * The runner is itself a generator: it yields the subgame's events back to
 * the parent's event pipe (so observers see SubgameStarted + every internal
 * event + SubgameEnded), and answers every decision yielded by the
 * subgame's runPriorityWindow with a RandomLegalController bound to the
 * subgame's RNG. The parent's event pipe sees the subgame events but the
 * parent's trigger registry does NOT — `child.emitEvent` is what fires
 * subgame triggers; the yielded events here are observability-only from
 * the parent's perspective.
 */
export function* runSubgame(parent: Game): Generator<EngineYield, SubgameOutcome, unknown> {
  const child = buildSubgameFromParent(parent);
  const controller = new RandomLegalController(child.rng);

  // Parent-side announce. The subgame's own NewGameStarted (if/when
  // setupFlow is layered in) is a separate matter — for the MVP runtime we
  // emit SubgameStarted on the parent pipe so observers see the boundary.
  yield parent.emitEvent(
    mkEvent("SubgameStarted", parent.turn, parent.phase, {
      parentTurn: parent.turn,
    }),
  );

  // Build a PhaseHandler for the child. Pre-seed the turn queue with one
  // turn per seat (matches run-game.ts SP1 behavior); PhaseHandler will
  // tear down once the queue drains or the child reaches terminal state.
  // We refresh the queue if play needs more rounds than the initial seed.
  const phaseHandler = new PhaseHandler(child);
  const seedTurnQueue = (): void => {
    if (phaseHandler.turnQueue.length > 0) return;
    for (const player of child.players) {
      phaseHandler.turnQueue.push({ activePlayer: player.seat, isExtra: false });
    }
  };
  seedTurnQueue();

  let yieldsConsumed = 0;
  let reachedTerminal = false;
  let budgetExhausted = false;
  const initialTurn = child.turn;

  // Drive the PhaseHandler. The handler is itself a generator — we pump
  // it manually so we can:
  //   (a) forward each event onto the parent pipe;
  //   (b) answer decisions via the RandomLegalController;
  //   (c) re-seed the turn queue if it drains while the subgame is still
  //       live (random-legal play that ends in pass-pass without a kill
  //       would otherwise terminate via empty queue rather than a real
  //       win condition).
  let runLoopGen = phaseHandler.run();
  let step: IteratorResult<EngineYield, void> = runLoopGen.next() as IteratorResult<EngineYield, void>;
  while (!step.done) {
    if (yieldsConsumed >= MAX_ENGINE_YIELDS) {
      budgetExhausted = true;
      break;
    }
    if (child.turn - initialTurn >= MAX_SUBGAME_TURNS) {
      budgetExhausted = true;
      break;
    }
    yieldsConsumed++;
    const y = step.value;
    if (y.kind === "event") {
      yield y;
      step = runLoopGen.next() as IteratorResult<EngineYield, void>;
      continue;
    }
    const response: DecisionResponse = controller.decide(y.request);
    step = runLoopGen.next(response) as IteratorResult<EngineYield, void>;

    // If PhaseHandler drained without a terminal, re-seed and resume.
    // (Done after the next() call so we observe the post-decision state.)
    if (step.done && !child.isTerminal() && child.turn - initialTurn < MAX_SUBGAME_TURNS) {
      // Random-legal exhausted a round of turns without a kill. Refresh
      // the turn queue and resume the generator. PhaseHandler.run()
      // returns when the queue is empty AND not terminal — we explicitly
      // create a new PhaseHandler instance so internal state is fresh
      // for the next round.
      const fresh = new PhaseHandler(child);
      for (const player of child.players) {
        fresh.turnQueue.push({ activePlayer: player.seat, isExtra: false });
      }
      runLoopGen = fresh.run();
      step = runLoopGen.next() as IteratorResult<EngineYield, void>;
    }
  }

  if (child.isTerminal()) reachedTerminal = true;
  if (!reachedTerminal && !budgetExhausted) {
    // Generator ran to completion without a terminal — synthesize a draw
    // so downstream gets a definitive outcome. This is the legitimate
    // "queue drained, no winner" path for empty-library zero-card games.
    if (!child.isTerminal()) {
      const draw: TerminalOutcome = { kind: "draw", reason: "subgameRunnerNoWinner" };
      endGame(child, draw, []);
    }
    reachedTerminal = true;
  }

  // Determine winner / losers.
  let winnerSeat: PlayerSeat | null = null;
  const loserSeats: PlayerSeat[] = [];

  if (reachedTerminal && child.terminalState) {
    const ts = child.terminalState;
    if (ts.outcome.kind === "win") {
      winnerSeat = ts.outcome.winner;
      for (const p of child.players) if (p.seat !== winnerSeat) loserSeats.push(p.seat);
    } else {
      // teamWin / draw → no single winner under Shahrazad semantics.
      // Fall back to score-based for parent-side life loss decision.
      const fallback = scoreBasedOutcome(parent);
      winnerSeat = fallback.winnerSeat;
      loserSeats.push(...fallback.loserSeats);
    }
  } else {
    // Budget exhaustion → score-based fallback (Wave 44 behaviour).
    const fallback = scoreBasedOutcome(parent);
    winnerSeat = fallback.winnerSeat;
    loserSeats.push(...fallback.loserSeats);
  }

  // Parent-side end-of-subgame pulse.
  yield parent.emitEvent(
    mkEvent("SubgameEnded", parent.turn, parent.phase, {
      parentTurn: parent.turn,
      outcome: reachedTerminal ? "terminal" : "boundedFallback",
    }),
  );

  // Avoid unused-variable warnings on mkEntityId when the build flag
  // matrix prunes some downstream uses. mkEntityId is imported defensively
  // for future Card-minting paths (deck shuffling expansions); reference
  // it via void to keep Biome happy without dead-import.
  void mkEntityId;
  // Reference initialTurn so the variable isn't flagged as unused when
  // budgetExhausted exits before the comparison branch fires.
  void initialTurn;

  return {
    winnerSeat,
    loserSeats,
    reachedTerminal: reachedTerminal && !budgetExhausted,
    windowsConsumed: yieldsConsumed,
  };
}

/**
 * Wave 44 fallback — when the subgame can't produce a clear winner (draw,
 * team-win in a non-team subgame, or budget exhaustion), use the
 * deterministic score-based picker the original MVP used. Same formula:
 *   score(p) = life * 2 + sum(power on battlefield) + library size
 * Higher score wins; active player breaks ties.
 *
 * Computed against the PARENT state — we want the subgame fallback to
 * still feel meaningful relative to the parent board, not the empty
 * subgame state at runner-exhaustion time.
 */
const scoreBasedOutcome = (parent: Game): { winnerSeat: PlayerSeat | null; loserSeats: PlayerSeat[] } => {
  if (parent.players.length < 2) {
    return { winnerSeat: null, loserSeats: [] };
  }

  const scoreOf = (seat: PlayerSeat): number => {
    const player = parent.getPlayer(seat);
    const life = player.life;
    const librarySize = player.zones.get(ZoneType.Library)?.size ?? 0;
    let powerTotal = 0;
    const battlefield = player.zones.get(ZoneType.Battlefield);
    if (battlefield) {
      for (const id of battlefield.toArray()) {
        const chars = parent.layerEngine.computeCharacteristics(id);
        powerTotal += chars.power ?? 0;
      }
    }
    return life * 2 + powerTotal + librarySize;
  };

  const a = parent.players[0];
  const b = parent.players[1];
  if (!a || !b) return { winnerSeat: null, loserSeats: [] };
  const seatA = a.seat;
  const seatB = b.seat;
  const scoreA = scoreOf(seatA);
  const scoreB = scoreOf(seatB);

  let winnerSeat: PlayerSeat;
  if (scoreA > scoreB) winnerSeat = seatA;
  else if (scoreB > scoreA) winnerSeat = seatB;
  else winnerSeat = parent.activePlayer;

  const loserSeats: PlayerSeat[] = parent.players.filter((p) => p.seat !== winnerSeat).map((p) => p.seat);
  return { winnerSeat, loserSeats };
};
