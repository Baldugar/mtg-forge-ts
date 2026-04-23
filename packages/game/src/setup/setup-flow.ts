// SPDX-License-Identifier: GPL-3.0-or-later
// Game setup generator. Owns the SP1 pre-first-turn sequence:
//   1. populate each player's zone map (Library, Hand, Graveyard, Battlefield,
//      Command) if the caller hasn't done so;
//   2. seed each library with the caller-supplied EntityId list;
//   3. shuffle each library deterministically via game.rng;
//   4. draw the starting hand for every player;
//   5. iterate the mulligan loop — SP1 supports the London rule only;
//   6. emit a GameStarted meta event.
//
// SP1 deliberately skips London's bottoming sub-step (send N cards to bottom
// for N mulligans taken) — Task 49's smoke test uses keep-first-hand paths
// and SP2 will wire the bottoming decision yield without changing this
// generator's outer contract. Vancouver / Paris / Free mulligan rules also
// arrive in SP2; hitting one from SP1 throws a structured error pointing at
// the SP2 gap rather than silently producing a broken game.
import {
  type DecisionRequest,
  type DecisionResponse,
  type EntityId,
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

  // Step 4: mulligan loop. SP1 — London rule only.
  if (game.rules.mulliganRule === "london") {
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
          rule: "london",
        };
        const response: DecisionResponse = yield { kind: "decision", request };
        if (response.kind !== "mulligan") {
          throw new Error(`setupGame: expected mulligan response, got ${response.kind}`);
        }
        if (response.keep) {
          // London bottoming is SP2 work — for now emit the MulliganTaken
          // event so observers see the terminal state of the loop.
          yield {
            kind: "event",
            event: mkEvent("MulliganTaken", game.turn, game.phase, {
              playerSeat: player.seat,
              handBefore: handSize,
              handAfter: currentHand.length,
              rule: "london",
            }),
          };
          break;
        }
        // Shuffle hand back into library and redraw.
        const lib = player.zones.get(ZoneType.Library);
        if (hand && lib) {
          const handCards = hand.toArray();
          hand.clear();
          for (const id of handCards) lib.add(id);
          const shuffled = game.rng.shuffle(lib.toArray());
          lib.clear();
          for (const id of shuffled) lib.add(id);
        }
        yield* action.drawCards(player.seat, handSize);
        mulligansTaken++;
        if (mulligansTaken > MULLIGAN_MAX) {
          throw new Error(
            `setupGame: excessive mulligans for seat ${player.seat as unknown as number} (>${MULLIGAN_MAX})`,
          );
        }
      }
    }
  } else {
    throw new Error(`setupGame: mulligan rule '${game.rules.mulliganRule}' not yet supported in SP1`);
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
