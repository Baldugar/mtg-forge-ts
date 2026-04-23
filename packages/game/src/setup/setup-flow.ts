// SPDX-License-Identifier: GPL-3.0-or-later
// Game setup generator. Owns the SP1 pre-first-turn sequence:
//   1. populate each player's zone map (Library, Hand, Graveyard, Battlefield,
//      Command) if the caller hasn't done so;
//   2. seed each library with the caller-supplied EntityId list;
//   3. shuffle each library deterministically via game.rng;
//   4. draw the starting hand for every player;
//   5. iterate the mulligan loop — SP1 implements FREE-mulligan semantics
//      (reshuffle + redraw the full hand size) regardless of the rule value
//      carried on GameRules.mulliganRule;
//   6. emit a GameStarted meta event.
//
// Mulligan semantics — SP1 / SP2 split:
//   SP1 implements free-mulligan semantics and emits MulliganTaken events
//   with rule: "free" so event-stream consumers aren't misled. London
//   (CR 103.5 — bottom N cards after N mulligans taken) requires a
//   'mulliganBottom' DecisionRequest kind that is not yet in the union;
//   when SP2 lands it, this generator will yield the bottoming step here
//   and relabel events back to "london". Vancouver / Paris follow the
//   same pattern. Hosts may still set GameRules.mulliganRule to any of
//   the four literals for forward-compat; SP1 accepts the literal but
//   runs the free-mulligan path and emits rule: "free" to signal the gap.
import {
  type DecisionRequest,
  type DecisionResponse,
  type EntityId,
  GameStateIntegrityError,
  IllegalDecisionError,
  type PlayerSeat,
  ZoneType,
  mkEvent,
} from "@mtg-forge-ts/core";
import type { EngineYield } from "../action/engine-yield.js";
import { GameAction } from "../action/game-action.js";
import type { Game } from "../game.js";
import type { Zone } from "../zone/zone.js";
import { Battlefield } from "../zone/zones/battlefield.js";
import { CommandZone } from "../zone/zones/command-zone.js";
import { Graveyard } from "../zone/zones/graveyard.js";
import { Hand } from "../zone/zones/hand.js";
import { Library } from "../zone/zones/library.js";

/**
 * Map seat → starting library as EntityIds. Index-by-seat keeps the public
 * shape obvious; `number` indexing mirrors how PlayerSeat is branded. Callers
 * pre-populate `game.cards` for each id so GameAction.drawCards can rewrite
 * the Card.zone pointer as cards move.
 */
export interface SetupDecks {
  readonly [seat: number]: readonly EntityId[];
}

// Per-player zone set covered by SP1. Sideboard/Ante/etc. populate in SP2 as
// scenarios require them; keeping the creator local to this module means
// Game doesn't need a zone-factory dependency outside setup.
const createPlayerZones = (seat: PlayerSeat): Map<ZoneType, Zone> => {
  const m = new Map<ZoneType, Zone>();
  m.set(ZoneType.Library, new Library(ZoneType.Library, seat));
  m.set(ZoneType.Hand, new Hand(ZoneType.Hand, seat));
  m.set(ZoneType.Graveyard, new Graveyard(ZoneType.Graveyard, seat));
  m.set(ZoneType.Battlefield, new Battlefield(ZoneType.Battlefield, seat));
  m.set(ZoneType.Command, new CommandZone(ZoneType.Command, seat));
  return m;
};

// Hard cap on mulligan iterations per seat — a well-behaved controller tops
// out at 7 (starting hand → free-mulligan-0 progression hits 0 cards). An
// infinite-reshuffle controller would hang the engine otherwise.
const MULLIGAN_MAX = 10;

export function* setupGame(game: Game, decks: SetupDecks): Generator<EngineYield, void, DecisionResponse> {
  const action = new GameAction(game);

  // Step 1: populate zones + seed libraries.
  for (const player of game.players) {
    if (player.zones.size === 0) {
      const zones = createPlayerZones(player.seat);
      for (const [type, zone] of zones) {
        player.zones.set(type, zone);
      }
    }
    const lib = player.zones.get(ZoneType.Library);
    const deck = decks[player.seat as unknown as number];
    if (lib && deck) {
      for (const cardId of deck) lib.add(cardId);
    }
  }

  // Step 2: shuffle each library via the game's rng for determinism.
  for (const player of game.players) {
    const lib = player.zones.get(ZoneType.Library);
    if (!lib) continue;
    const shuffled = game.rng.shuffle(lib.toArray());
    lib.clear();
    for (const id of shuffled) lib.add(id);
  }

  // Step 3: draw starting hands.
  const handSize = game.rules.startingHandSize;
  for (const player of game.players) {
    yield* action.drawCards(player.seat, handSize);
  }

  // Step 4: mulligan loop. SP1 runs free-mulligan semantics for every
  // rule literal (see module docblock). When SP2 adds the bottoming
  // DecisionRequest kind, re-branch on rule here and emit the bottoming
  // yield before MulliganTaken.
  for (const player of game.players) {
    let mulligansTaken = 0;
    while (true) {
      const hand = player.zones.get(ZoneType.Hand);
      const currentHand: readonly EntityId[] = hand ? hand.toArray() : [];
      const request: DecisionRequest = {
        kind: "mulligan",
        playerSeat: player.seat,
        currentHand,
        mulligansSoFar: mulligansTaken,
        rule: "free",
      };
      const response: DecisionResponse = yield { kind: "decision", request };
      if (response.kind !== "mulligan") {
        throw new IllegalDecisionError(`setupGame: expected mulligan response, got ${response.kind}`);
      }
      if (response.keep) {
        yield {
          kind: "event",
          event: mkEvent("MulliganTaken", game.turn, game.phase, {
            playerSeat: player.seat,
            handBefore: handSize,
            handAfter: currentHand.length,
            rule: "free",
          }),
        };
        break;
      }
      // Shuffle hand back into library and redraw.
      const lib = player.zones.get(ZoneType.Library);
      if (hand && lib) {
        const handCards = hand.toArray();
        hand.clear();
        for (const id of handCards) {
          lib.add(id);
          // WHY: the Card's .zone field mirrors its Zone-map location. When
          // we physically move cards from Hand back to Library during a
          // mulligan reshuffle, the Card records must follow or downstream
          // consumers (AI, UI, SBA scan) will see Hand cards that no longer
          // exist in any hand zone.
          const card = game.cards.get(id);
          if (card) card.zone = ZoneType.Library;
        }
        const shuffled = game.rng.shuffle(lib.toArray());
        lib.clear();
        for (const id of shuffled) lib.add(id);
      }
      yield* action.drawCards(player.seat, handSize);
      mulligansTaken++;
      if (mulligansTaken > MULLIGAN_MAX) {
        throw new GameStateIntegrityError(
          `setupGame: excessive mulligans for seat ${player.seat as unknown as number} (>${MULLIGAN_MAX})`,
        );
      }
    }
  }

  // Step 5: emit GameStarted so downstream subscribers can latch the seat
  // roster and first-player selection.
  yield {
    kind: "event",
    event: mkEvent("GameStarted", game.turn, game.phase, {
      seats: game.players.map((p) => p.seat),
      firstPlayer: game.activePlayer,
    }),
  };
}
