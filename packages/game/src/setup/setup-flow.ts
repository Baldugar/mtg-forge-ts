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
// Mulligan semantics — SP1 coverage:
//   SP1 implements London mulligan (CR 103.5 — after N mulligans taken, the
//   keeping player bottoms N cards from their hand) via the 'mulliganBottom'
//   DecisionRequest kind. For `rule: "london"`, setup yields a mulliganBottom
//   request after the player keeps and emits MulliganTaken with rule:"london".
//   For any other rule literal (free / vancouver / paris), SP1 still runs the
//   free-mulligan path (reshuffle + redraw up to full hand size) and emits
//   MulliganTaken with rule:"free"; SP2 will branch those paths to their
//   respective variant semantics.
import {
  type DecisionRequest,
  type DecisionResponse,
  type EntityId,
  GameStateIntegrityError,
  IllegalDecisionError,
  type PlayerSeat,
  ZoneType,
  mkEvent,
  mkPlayerSeat,
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
import { OutsideTheGame } from "../zone/zones/outside-the-game.js";
import { Sideboard } from "../zone/zones/sideboard.js";

/**
 * Map seat → starting library as EntityIds. Index-by-seat keeps the public
 * shape obvious; `number` indexing mirrors how PlayerSeat is branded. Callers
 * pre-populate `game.cards` for each id so GameAction.drawCards can rewrite
 * the Card.zone pointer as cards move.
 */
export interface SetupDecks {
  readonly [seat: number]: readonly EntityId[];
}

/**
 * Per-seat commander cards by mode. SP1 accepts one of:
 *   - "single": one commander card goes to the command zone
 *   - "partners": two partner commanders go to the command zone
 *   - "background": commander + Background enchantment go to the command zone
 *   - "oathbreaker": planeswalker + signature spell go to the command zone
 *
 * EntityIds must already live in the seat's library at call time (the caller
 * includes them in the SetupDecks entry). setupGame removes them from the
 * library — before shuffling — and places them in the command zone.
 *
 * This is the engine-side mirror of core's CommanderSlot discriminated
 * union, expressed in EntityId terms (CommanderSlot uses PaperCards).
 */
export type CommanderAssignment =
  | { readonly kind: "none" }
  | { readonly kind: "single"; readonly commander: EntityId }
  | { readonly kind: "partners"; readonly a: EntityId; readonly b: EntityId }
  | {
      readonly kind: "background";
      readonly commander: EntityId;
      readonly background: EntityId;
    }
  | {
      readonly kind: "oathbreaker";
      readonly planeswalker: EntityId;
      readonly signatureSpell: EntityId;
    };

export interface SetupOptions {
  readonly decks: SetupDecks;
  /**
   * Optional per-seat commander assignment. Omit for non-Commander formats.
   * When present, setupGame removes the named EntityIds from the seat's
   * library (if present) and places them in the command zone before
   * shuffling. SP1 §6.4 + §6.6.
   */
  readonly commanders?: { readonly [seat: number]: CommanderAssignment };
}

// Per-player zone set covered by SP1. Sideboard/Ante/etc. populate in SP2 as
// scenarios require them; keeping the creator local to this module means
// Game doesn't need a zone-factory dependency outside setup. Wave 66 adds
// Sideboard + OutsideTheGame so Companion / Learn / Double-team / Wish-style
// effects always find a non-null source zone (cards are added/removed by
// downstream pipelines, but the empty zone always exists).
const createPlayerZones = (seat: PlayerSeat): Map<ZoneType, Zone> => {
  const m = new Map<ZoneType, Zone>();
  m.set(ZoneType.Library, new Library(ZoneType.Library, seat));
  m.set(ZoneType.Hand, new Hand(ZoneType.Hand, seat));
  m.set(ZoneType.Graveyard, new Graveyard(ZoneType.Graveyard, seat));
  m.set(ZoneType.Battlefield, new Battlefield(ZoneType.Battlefield, seat));
  m.set(ZoneType.Command, new CommandZone(ZoneType.Command, seat));
  // Wave 66 — Sideboard (CR 100.4) + OutsideTheGame (engine-side staging).
  m.set(ZoneType.Sideboard, new Sideboard(ZoneType.Sideboard, seat));
  m.set(ZoneType.OutsideTheGame, new OutsideTheGame(ZoneType.OutsideTheGame, seat));
  return m;
};

// Hard cap on mulligan iterations per seat — a well-behaved controller tops
// out at 7 (starting hand → free-mulligan-0 progression hits 0 cards). An
// infinite-reshuffle controller would hang the engine otherwise.
const MULLIGAN_MAX = 10;

// Extract the EntityIds a CommanderAssignment names. Kept local to setup
// because it's the only site that consumes the union into a flat list; any
// future command-zone mover elsewhere can lift this upwards.
const commanderIds = (slot: CommanderAssignment): readonly EntityId[] => {
  switch (slot.kind) {
    case "none":
      return [];
    case "single":
      return [slot.commander];
    case "partners":
      return [slot.a, slot.b];
    case "background":
      return [slot.commander, slot.background];
    case "oathbreaker":
      return [slot.planeswalker, slot.signatureSpell];
  }
};

// Overloads: accept either the legacy `decks` positional arg (Round-1 API)
// or the richer SetupOptions. SP1 consumers that don't use Commander keep
// the old call shape; Commander hosts pass SetupOptions.
export function setupGame(game: Game, decks: SetupDecks): Generator<EngineYield, void, DecisionResponse>;
export function setupGame(game: Game, opts: SetupOptions): Generator<EngineYield, void, DecisionResponse>;
export function* setupGame(
  game: Game,
  decksOrOpts: SetupDecks | SetupOptions,
): Generator<EngineYield, void, DecisionResponse> {
  // Narrow the union: SetupOptions carries a `decks` property; SetupDecks
  // is a numeric-indexed record whose values are EntityId arrays. If the
  // incoming object has a `decks` field whose value is itself a record
  // (i.e. not an array), treat it as SetupOptions. EntityIds are branded
  // numbers, so SetupDecks[0] is an array of numbers — never `undefined`
  // for a well-formed deck.
  const isOptions =
    typeof decksOrOpts === "object" &&
    decksOrOpts !== null &&
    "decks" in decksOrOpts &&
    !Array.isArray((decksOrOpts as { decks: unknown }).decks);
  const opts: SetupOptions = isOptions ? (decksOrOpts as SetupOptions) : { decks: decksOrOpts as SetupDecks };
  const decks = opts.decks;
  const commanders = opts.commanders;
  const action = new GameAction(game);

  // Step 0: die-roll for starting player if not pre-assigned. Hosts that
  // want deterministic seat-0 starts pre-set game.startingPlayer before
  // invoking setupGame. `rng.nextInt` guarantees determinism under a fixed
  // seed — the "die-roll" in Forge's MatchStart.java is equivalent.
  if (game.startingPlayer === null) {
    const rolled = game.rng.nextInt(0, game.players.length);
    game.startingPlayer = mkPlayerSeat(rolled);
  }
  // WHY: activePlayer must track startingPlayer before any turn-based logic
  // reads it (e.g. first-turn Draw skip check later in phase-handler).
  game.activePlayer = game.startingPlayer;

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

  // Step 1b (SP1 §6.3): team assignment is resolved at Game construction
  // time (Player.teamId, pulled from rules.teamAssignments?.[seat] ?? seat).
  // Nothing to do here except acknowledge the spec slot — a future override
  // hook (mid-setup team rewrite, e.g. Archenemy) would live in this step.

  // Step 1c (SP1 §6.4 + §6.6): commander assignment + move-to-command-zone.
  // For each seat with a non-"none" CommanderAssignment, remove the named
  // EntityIds from the library (if present) and push them into the command
  // zone. Must run BEFORE shuffling so commanders never end up in the
  // library's random ordering.
  if (commanders !== undefined) {
    for (const player of game.players) {
      const slot = commanders[player.seat as unknown as number];
      if (!slot || slot.kind === "none") continue;
      const lib = player.zones.get(ZoneType.Library);
      const cmdZone = player.zones.get(ZoneType.Command);
      if (!lib || !cmdZone) {
        throw new GameStateIntegrityError(
          `setupGame: seat ${player.seat as unknown as number} missing Library or Command zone`,
        );
      }
      const ids = commanderIds(slot);
      for (const id of ids) {
        // Remove from library if present; callers include commander ids in
        // their deck list so the pre-shuffle library contains them.
        lib.remove(id);
        cmdZone.add(id);
        const card = game.cards.get(id);
        // WHY: keep Card.zone in sync with the physical move so SBA / zone
        // queries don't see stale Library pointers.
        if (card) card.zone = ZoneType.Command;
      }
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

  // Step 2b (SP2 Milestone W Task 72) — CR 702.139 companion declaration.
  // Before any draw/mulligan, each seat may declare a companion from their
  // sideboard. SP2 scope emits the decision and records the declaration on
  // Game.companions; enforcement of the companion's deckbuilding condition
  // lives in SP6 (formats). `sideboardCardIds` defaults to an empty list
  // since SP2 has no sideboard zone yet — consumers wanting richer
  // companion support pre-seed a Sideboard zone and extend this call to
  // read from it. An `undefined` zone means no legal companion options,
  // so the controller's only legal answer is `companionId: null`.
  for (const player of game.players) {
    const sideboard = player.zones.get(ZoneType.Sideboard);
    const sideboardIds: readonly EntityId[] = sideboard ? sideboard.toArray() : [];
    const req: DecisionRequest = {
      kind: "companionDeclaration",
      playerSeat: player.seat,
      sideboardCardIds: sideboardIds,
    };
    const resp: DecisionResponse = yield { kind: "decision", request: req };
    if (resp.kind !== "companionDeclaration") {
      throw new IllegalDecisionError(`setupGame: expected companionDeclaration, got ${resp.kind}`);
    }
    // Validate the chosen id is in the enumerated sideboard; null is the
    // "decline" sentinel. An empty sideboard forces null.
    if (resp.companionId !== null) {
      if (!sideboardIds.includes(resp.companionId)) {
        throw new IllegalDecisionError(
          `setupGame: companion id ${resp.companionId as unknown as number} not in seat ${
            player.seat as unknown as number
          }'s sideboard`,
        );
      }
    }
    game.companions.set(player.seat, resp.companionId);
  }

  // Step 3: draw starting hands.
  const handSize = game.rules.startingHandSize;
  for (const player of game.players) {
    yield* action.drawCards(player.seat, handSize);
  }

  // Step 4: mulligan loop. SP1 branches on rules.mulliganRule:
  //   - "london": yield mulligan request with rule:"london"; on keep with N
  //     mulligans taken, yield a second 'mulliganBottom' request for N cards
  //     and move the chosen cards to the BOTTOM of the library (no reshuffle
  //     per CR 103.5). Emit MulliganTaken with rule:"london".
  //   - other rules: free-mulligan semantics (legacy path) — emit
  //     MulliganTaken with rule:"free".
  const isLondon = game.rules.mulliganRule === "london";
  const eventRule = isLondon ? "london" : "free";
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
        rule: eventRule,
      };
      const response: DecisionResponse = yield { kind: "decision", request };
      if (response.kind !== "mulligan") {
        throw new IllegalDecisionError(`setupGame: expected mulligan response, got ${response.kind}`);
      }
      if (response.keep) {
        // London: after keep with N>0 mulligans, bottom N cards via a
        // dedicated mulliganBottom DecisionRequest. The bottomed cards move
        // to the BOTTOM of the library without reshuffling (CR 103.5).
        if (isLondon && mulligansTaken > 0) {
          const lib = player.zones.get(ZoneType.Library);
          if (!hand || !lib) {
            throw new GameStateIntegrityError(
              `setupGame: seat ${player.seat as unknown as number} missing Hand or Library for London bottoming`,
            );
          }
          const bottomReq: DecisionRequest = {
            kind: "mulliganBottom",
            playerSeat: player.seat,
            hand: hand.toArray(),
            countToBottom: mulligansTaken,
          };
          const bottomResp: DecisionResponse = yield { kind: "decision", request: bottomReq };
          if (bottomResp.kind !== "mulliganBottom") {
            throw new IllegalDecisionError(
              `setupGame: expected mulliganBottom response, got ${bottomResp.kind}`,
            );
          }
          if (bottomResp.bottomed.length !== mulligansTaken) {
            throw new IllegalDecisionError(
              `setupGame: mulliganBottom.bottomed.length (${bottomResp.bottomed.length}) must equal countToBottom (${mulligansTaken})`,
            );
          }
          // Validate every chosen id belongs to the current hand; reject
          // duplicates so the caller can't bottom the same card twice.
          const handSet = new Set(hand.toArray());
          const chosen = new Set<EntityId>();
          for (const id of bottomResp.bottomed) {
            if (!handSet.has(id)) {
              throw new IllegalDecisionError(
                `setupGame: mulliganBottom id ${id as unknown as number} not in hand for seat ${player.seat as unknown as number}`,
              );
            }
            if (chosen.has(id)) {
              throw new IllegalDecisionError(
                `setupGame: mulliganBottom duplicate id ${id as unknown as number}`,
              );
            }
            chosen.add(id);
          }
          // Move each chosen card from Hand to the bottom of Library (append
          // at items.length). Order of response preserved — first element is
          // lowest-index (outermost-bottom per CR 103.5 phrasing "bottom in
          // any order" means caller-chosen ordering is honored).
          for (const id of bottomResp.bottomed) {
            hand.remove(id);
            lib.add(id); // defaults to bottom (items.length)
            const card = game.cards.get(id);
            if (card) card.zone = ZoneType.Library;
          }
        }
        yield {
          kind: "event",
          event: mkEvent("MulliganTaken", game.turn, game.phase, {
            playerSeat: player.seat,
            handBefore: handSize,
            handAfter: hand ? hand.size : 0,
            rule: eventRule,
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
      // London always redraws to full hand size; bottoming happens after keep.
      // Free/Vancouver/Paris also redraw to full in SP1 (see module docblock).
      yield* action.drawCards(player.seat, handSize);
      mulligansTaken++;
      if (mulligansTaken > MULLIGAN_MAX) {
        throw new GameStateIntegrityError(
          `setupGame: excessive mulligans for seat ${player.seat as unknown as number} (>${MULLIGAN_MAX})`,
        );
      }
    }
  }

  // Step 4b (SP2 Milestone W Task 72) — CR 103.5 opening-hand actions.
  // After mulligans settle and before the first turn begins, each seat is
  // offered an openingHandAction decision. Cards in hand with opening-hand
  // abilities (Leyline of the Void, Gemstone Caverns, Chancellor cycle,
  // etc.) populate `availableActions`; the controller picks zero or more
  // to activate. SP2 scope emits the decision but does not enumerate
  // abilities — `availableActions` is empty until SP3's ability registry
  // surfaces CardDefinition.openingHandActions. Recording the chosen-
  // action ids on Game.flags lands in SP3 once the action-processing
  // pipeline exists.
  for (const player of game.players) {
    const openingReq: DecisionRequest = {
      kind: "openingHandAction",
      playerSeat: player.seat,
      availableActions: [],
    };
    const openingResp: DecisionResponse = yield { kind: "decision", request: openingReq };
    if (openingResp.kind !== "openingHandAction") {
      throw new IllegalDecisionError(`setupGame: expected openingHandAction, got ${openingResp.kind}`);
    }
    // SP2 accepts only empty responses (no actions enumerated yet). SP3
    // validates chosen ids against availableActions and routes each to
    // its ability handler.
    if (openingResp.chosenActions.length > 0) {
      throw new IllegalDecisionError(
        `setupGame: SP2 opening-hand actions must be empty (received ${openingResp.chosenActions.length})`,
      );
    }
  }

  // Step 5: emit GameStarted so downstream subscribers can latch the seat
  // roster and first-player selection. firstPlayer reflects the
  // die-roll outcome captured in game.startingPlayer at step 0.
  yield {
    kind: "event",
    event: mkEvent("GameStarted", game.turn, game.phase, {
      seats: game.players.map((p) => p.seat),
      firstPlayer: game.startingPlayer ?? game.activePlayer,
    }),
  };
}
