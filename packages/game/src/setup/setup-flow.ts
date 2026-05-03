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
// TODO(SP6 — Two-Headed Giant turn-merging, CR 810.7):
//   2HG MVP scope (M7.13e) ships the 4-seat lobby + shared team-life model
//   only. The full "teammates take their turn together" semantics — both
//   teammates untap, draw, get priority during the team's turn, share
//   mulligan decisions — live in SP6's per-format orchestration. The engine
//   already supports up to N players (see Game.players), so the structural
//   blocker is not the player count; it is the priority loop's assumption
//   that activePlayer is a single PlayerSeat (game.ts: activePlayer:
//   PlayerSeat). A team-aware priority window in SP6 will own the
//   "active TEAM" → "both teammates can act in any order" expansion.
//   Until then, 2HG plays as 4 individual seats whose two pairs share a
//   life total + a 15-poison loss threshold.
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
import { effectiveStartingHandSize } from "../player.js";
import { onZoneChange } from "../statics/zone-activation.js";
import type { Zone } from "../zone/zone.js";
import { Battlefield } from "../zone/zones/battlefield.js";
import { CommandZone } from "../zone/zones/command-zone.js";
import { Graveyard } from "../zone/zones/graveyard.js";
import { Hand } from "../zone/zones/hand.js";
import { Library } from "../zone/zones/library.js";
import { OutsideTheGame } from "../zone/zones/outside-the-game.js";
import { PlanarDeck } from "../zone/zones/planar-deck.js";
import { SchemeDeck } from "../zone/zones/scheme-deck.js";
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

/**
 * Per-seat Vanguard avatar assignment (CR 902). SetupGame places the
 * referenced card in the seat's command zone, applies the avatar's
 * `HandLifeModifier:+H/+L` to the player's starting life and opening hand
 * size, and activates the avatar's printed triggers + statics so abilities
 * with `TriggerZones$ Command` (or no zone restriction) fire while the
 * avatar sits in the command zone.
 *
 * The EntityId must already be present in `game.cards` at call time; it
 * does NOT need to be in the seat's library (avatars are not part of the
 * 60-card deck — Forge models them as a separate command-zone slot
 * declared at lobby time).
 */
export interface VanguardAssignment {
  readonly seat: PlayerSeat;
  readonly cardId: EntityId;
}

/**
 * Per-seat Conspiracy assignment (CR 901). Conspiracy cards are NOT part of
 * a player's 60-card deck — they live exclusively in the command zone for
 * the entire game (Conspiracy-format draft, CMR / CN2 sets). setupGame
 * places each entry's `cardId` in the named seat's command zone, then
 * activates the card's printed statics + triggers + replacements so static
 * effects with `EffectZone$ Command` and triggers with `TriggerZones$
 * Command` fire from the command zone for the duration of the game.
 *
 * The EntityId must already be present in `game.cards` at call time and
 * the live Card SHOULD already have its abilities populated (via
 * `card.activate*FromDefinition`) before setupGame runs, OR the caller
 * may pre-seed `card.intrinsicStatics` / `card.triggeredAbilities` /
 * `card.replacementAbilities` directly for tests. setupGame only handles
 * the zone placement + the static/trigger zone-activation hand-off.
 */
export interface ConspiracyAssignment {
  readonly seat: PlayerSeat;
  readonly cardId: EntityId;
}

/**
 * Per-seat Planechase assignment (CR 901). Each seat in a Planechase
 * match brings a planar deck (a separate, hidden, ordered pile of Plane
 * and Phenomenon cards) which lives in `ZoneType.PlanarDeck`. The active
 * plane lives face-up in seat 0's `ZoneType.Command` zone — the active
 * plane is shared across the table by convention (Forge's
 * MatchPlayer.planeStack lives on the active player's command zone, and
 * we mirror that by keeping the single active plane on seat 0's command
 * zone for the duration of the match).
 *
 * `planarDeck` enumerates EntityIds that land in the named seat's
 * PlanarDeck zone in the order given (top-of-deck first). `activePlane`
 * is the EntityId placed face-up in seat 0's command zone — its printed
 * statics + triggers + replacements activate immediately so continuous
 * effects like "creatures get +1/+0" register with the layer engine and
 * abilities tagged for the Command zone fire from there.
 *
 * EntityIds in `planarDeck` and `activePlane` must already be present in
 * `game.cards` at call time. They must NOT appear in any seat's library
 * (planes/phenomena are strictly outside the 60-card deck).
 */
export interface PlanechaseAssignment {
  readonly seat: PlayerSeat;
  readonly planarDeck: readonly EntityId[];
  readonly activePlane: EntityId;
}

/**
 * Per-seat Archenemy assignment (CR 904). The archenemy plays alone
 * against the rest of the table — they start with extra life (40 by
 * default per CR 904.5) and bring their own SCHEME deck (an ordered,
 * hidden, face-down pile of Scheme cards) which lives in
 * `ZoneType.SchemeDeck`. At the beginning of each archenemy upkeep, the
 * archenemy "sets in motion" the top scheme: the engine moves the top
 * card to the Command zone face-up where its triggered abilities resolve
 * (CR 904.7).
 *
 * `schemeDeck` enumerates EntityIds that land in the named seat's
 * SchemeDeck zone in the order given (top-of-deck first). EntityIds must
 * already be present in `game.cards` at call time; they must NOT appear
 * in any seat's library (schemes are strictly outside the 60-card deck).
 *
 * `startingLife` overrides the archenemy's life total — defaults to 40
 * per CR 904.5. Pass an explicit value (e.g. 30 for "Two-Headed Giant
 * archenemy" variants) to override.
 */
export interface ArchenemyAssignment {
  readonly seat: PlayerSeat;
  readonly schemeDeck: readonly EntityId[];
  readonly startingLife?: number;
}

export interface SetupOptions {
  readonly decks: SetupDecks;
  /**
   * Optional per-seat commander assignment. Omit for non-Commander formats.
   * When present, setupGame removes the named EntityIds from the seat's
   * library (if present) and places them in the command zone before
   * shuffling. SP1 §6.4 + §6.6.
   */
  readonly commanders?: { readonly [seat: number]: CommanderAssignment };
  /**
   * Optional Vanguard avatar assignments (CR 902). One entry per seat
   * that brings an avatar — seats omitted from this list play without one.
   * The avatar card's `HandLifeModifier:+H/+L` adjusts the controller's
   * starting life and opening-hand size; printed triggers/statics tagged
   * for the Command zone activate so abilities fire from the command zone
   * for the duration of the game.
   */
  readonly vanguard?: readonly VanguardAssignment[];
  /**
   * Optional Conspiracy cards (CR 901). Each entry seeds one Conspiracy
   * into the named seat's command zone face-up; the engine activates the
   * card's printed statics + triggers + replacements so abilities with
   * `EffectZone$ Command` / `TriggerZones$ Command` register and fire from
   * the command zone for the duration of the game.
   *
   * A seat may bring zero or many Conspiracies (Conspiracy-format draft
   * decks routinely include 5+ in the command zone). Conspiracies must
   * NOT appear in the seat's library; they are a separate command-zone
   * pool. Hidden Agenda / Double Agenda variants are accepted — face-up
   * default placement is correct for SP1 since the agenda-naming flow
   * (face-down placement + secret name choice) lives in SP6.
   */
  readonly conspiracies?: readonly ConspiracyAssignment[];
  /**
   * Optional Planechase variant (CR 901). Each entry seeds one seat's
   * planar deck (a hidden, ordered pile in `ZoneType.PlanarDeck`) and
   * declares the seat's `activePlane` — the active plane is placed
   * face-up in seat 0's command zone (shared-active-plane convention).
   * setupGame activates the active plane's printed statics + triggers +
   * replacements so abilities with `EffectZone$ Command` /
   * `TriggerZones$ Command` register and fire from the command zone for
   * the duration of the active plane's tenure.
   *
   * Cards in `planarDeck` must already exist in `game.cards`; they must
   * NOT appear in any library (planes/phenomena are a separate,
   * command-zone-aggregate pile per `isPartOfCommandZone`). When two or
   * more seats supply Planechase entries, all planar decks populate but
   * only seat 0's `activePlane` lands in the command zone — the other
   * seats' active-plane choices stage on top of their planar deck (CR
   * 901.6 ordering: when a player planeswalks, they reveal cards until a
   * Plane is found; pre-staging lets that pipeline pop the right card).
   */
  readonly planechase?: readonly PlanechaseAssignment[];
  /**
   * Optional Archenemy variant (CR 904). Each entry designates one seat
   * as an archenemy: setupGame seeds the seat's `schemeDeck` into
   * `ZoneType.SchemeDeck` (preserving caller order — top-of-deck first)
   * and sets that seat's life to `startingLife` (default 40 per CR
   * 904.5). Schemes themselves are not activated at setup time — they
   * remain hidden in the SchemeDeck until set in motion via
   * `GameAction.setInMotion`, which moves the top scheme to the Command
   * zone, activates its triggers + statics, and emits the
   * SchemeSetInMotion event so `T:Mode$ SetInMotion` triggers fire.
   *
   * Cards in `schemeDeck` must already exist in `game.cards`; they must
   * NOT appear in any library. A seat may carry zero or one
   * ArchenemyAssignment entries — multi-archenemy variants are not
   * supported (CR 904.4 caps the archenemy count at one per game).
   */
  readonly archenemy?: readonly ArchenemyAssignment[];
  /**
   * Optional Two-Headed Giant team configuration (CR 810). When the
   * variant is applied (`rules.appliedVariants` includes
   * "TwoHeadedGiant"), the host may pass an explicit team grouping here
   * so that setupGame can:
   *   1. validate that every seat is assigned to exactly one team;
   *   2. assert each team's startingLife is correctly seeded into
   *      `game.teamLife` (the shared pool populated by the Game ctor);
   *   3. mirror the shared starting life onto every member's
   *      `Player.life` so all per-player life readers (loss conditions,
   *      SBA, life triggers) see the team total before any mutation.
   *
   * The same team mapping is normally also expressed via
   * `rules.teamAssignments` (seat → teamId) — when both are present,
   * setupGame validates they agree. When only `teams` is given, the
   * Game ctor's `teamId` derivation falls back to `seat = teamId`
   * (per-seat team) because the rules object is consumed before
   * setupGame runs; in that case `teams` re-stamps the right teamId
   * onto each player here so the team-life pool is keyed correctly.
   */
  readonly teams?: readonly TeamAssignment[];
}

/**
 * M7.13e — Two-Headed Giant team grouping (CR 810). Each team identifies
 * the participating seats and the shared life total. The default team
 * size in 2HG is 2 players; the engine accepts any non-empty seat list
 * so future Emperor / Tempest-of-Light multi-headed variants share the
 * same primitive. `startingLife` defaults to 30 (CR 810.5a) but is
 * honored verbatim when supplied so format hosts can override.
 */
export interface TeamAssignment {
  readonly teamId: number;
  readonly seats: readonly PlayerSeat[];
  readonly startingLife?: number;
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
  // M7.13b — Planechase (CR 901). Each player gets an empty PlanarDeck
  // by default; setupGame populates it from the optional `planechase`
  // SetupOptions field. Keeping the zone empty (rather than absent)
  // means SBA / zone-query consumers always find a non-null source zone.
  m.set(ZoneType.PlanarDeck, new PlanarDeck(ZoneType.PlanarDeck, seat));
  // M7.13c — Archenemy (CR 904). Each player gets an empty SchemeDeck
  // by default; setupGame populates the archenemy's pile from the
  // optional `archenemy` SetupOptions field. Non-archenemy seats keep
  // an empty SchemeDeck so zone queries always find a non-null source.
  m.set(ZoneType.SchemeDeck, new SchemeDeck(ZoneType.SchemeDeck, seat));
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
  const vanguard = opts.vanguard;
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
  //
  // M7.13e — Two-Headed Giant team override + life mirroring (CR 810).
  // When the host supplies an explicit `teams` mapping, we:
  //   1. validate that every seat appears in exactly one team;
  //   2. re-stamp Player.teamId from the team mapping (so 2HG hosts that
  //      forgot to populate rules.teamAssignments still get the right
  //      teamId per-player);
  //   3. (re)build game.teamLife from the supplied team list so the
  //      shared pool reflects the per-team `startingLife` override (or
  //      the rules default when omitted);
  //   4. mirror the shared team life onto every member's Player.life so
  //      all per-player life readers observe the team total before any
  //      mutation. CR 810.5a — both teammates start at 30 (or whatever
  //      the host-supplied team total is).
  // When `teams` is absent, the Game-ctor derived teamLife pool already
  // has the correct shape; we still mirror life on a 2HG variant so
  // overrides to rules.startingLife flow into Player.life uniformly.
  if (opts.teams !== undefined) {
    const seen = new Set<number>();
    for (const team of opts.teams) {
      for (const seat of team.seats) {
        const seatNum = seat as unknown as number;
        if (seen.has(seatNum)) {
          throw new GameStateIntegrityError(`setupGame: seat ${seatNum} listed in more than one team`);
        }
        seen.add(seatNum);
        const player = game.players.find((p) => p.seat === seat);
        if (!player) {
          throw new GameStateIntegrityError(`setupGame: team includes unknown seat ${seatNum}`);
        }
        player.teamId = team.teamId;
      }
    }
    // Validate every seat is on a team (no "free" seats).
    for (const player of game.players) {
      if (!seen.has(player.seat as unknown as number)) {
        throw new GameStateIntegrityError(
          `setupGame: seat ${player.seat as unknown as number} not assigned to any team`,
        );
      }
    }
    // Rebuild teamLife to honor per-team startingLife overrides.
    if (game.rules.appliedVariants.includes("TwoHeadedGiant")) {
      const pool = new Map<number, number>();
      for (const team of opts.teams) {
        const life = team.startingLife ?? game.rules.startingLife;
        pool.set(team.teamId, life);
      }
      game.teamLife = pool;
    }
  }
  // Mirror the shared team life onto every team member's Player.life so
  // life readers (loss conditions, SBA, "your life total"-style svars,
  // life-loss triggers) observe the team total uniformly. Skipped when
  // teamLife is null (non-2HG game).
  if (game.teamLife !== null) {
    for (const player of game.players) {
      const teamLife = game.teamLife.get(player.teamId);
      if (teamLife !== undefined) player.life = teamLife;
    }
  }

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

  // Step 1d (CR 902): Vanguard avatar placement. For each declared seat,
  // place the avatar's EntityId in the Command zone, apply the avatar's
  // `HandLifeModifier:+H/+L` to starting life and the player's
  // `startingHandSizeMod` accumulator (so `effectiveStartingHandSize`
  // picks it up at draw time), and activate the avatar's printed
  // triggers + statics so abilities tagged for the Command zone fire
  // for the duration of the game. Must run before shuffling so the
  // avatar id (which is NOT in the library) cannot accidentally collide
  // with a library entry.
  if (vanguard !== undefined) {
    for (const slot of vanguard) {
      const player = game.players.find((p) => p.seat === slot.seat);
      if (!player) {
        throw new GameStateIntegrityError(
          `setupGame: vanguard assignment for unknown seat ${slot.seat as unknown as number}`,
        );
      }
      const cmdZone = player.zones.get(ZoneType.Command);
      if (!cmdZone) {
        throw new GameStateIntegrityError(
          `setupGame: seat ${player.seat as unknown as number} missing Command zone for Vanguard`,
        );
      }
      const card = game.cards.get(slot.cardId);
      if (!card) {
        throw new GameStateIntegrityError(
          `setupGame: Vanguard card id ${slot.cardId as unknown as number} not in game.cards`,
        );
      }
      // Defensive: if the avatar ended up in the library (caller seeded
      // it there by mistake), pull it out so it doesn't get shuffled.
      const lib = player.zones.get(ZoneType.Library);
      if (lib) lib.remove(slot.cardId);
      cmdZone.add(slot.cardId);
      card.zone = ZoneType.Command;
      // Apply the modifier. Forge stores both halves as signed integers;
      // `handLifeModifier` is undefined on cards parsed without the line.
      const def = card.paperCard.definition;
      const mod = def?.handLifeModifier;
      if (mod) {
        player.life += mod.life;
        player.startingHandSizeMod = (player.startingHandSizeMod ?? 0) + mod.hand;
      }
      // Activate triggers and statics so command-zone abilities fire.
      // (Spell abilities are activated lazily by the cast pipeline; the
      // avatar is never cast, so we don't bind activated abilities here.)
      card.activateTriggersFromDefinition(game);
      card.activateStaticsFromDefinition(game);
      // Hand the freshly-built intrinsic statics to the zone-activation
      // discipline so the static-effect registry actually registers them
      // (intrinsicStatics by itself only stores the built abilities — the
      // registry-side membership is gated on onZoneChange transitioning
      // the source from a non-active zone to one of its activeInZones).
      onZoneChange(game, slot.cardId, ZoneType.None, ZoneType.Command);
    }
  }

  // Step 1e (CR 901): Conspiracy placement. Each entry seeds one card into
  // its named seat's command zone face-up, then activates the printed
  // statics + triggers + replacements so abilities tagged for the Command
  // zone fire from the command zone for the duration of the game.
  // Conspiracies are NOT part of the seat's library (they're a separate
  // command-zone pool); we defensively pull the id out of the library if
  // the caller mis-seeded it there.
  const conspiracies = opts.conspiracies;
  if (conspiracies !== undefined) {
    for (const slot of conspiracies) {
      const player = game.players.find((p) => p.seat === slot.seat);
      if (!player) {
        throw new GameStateIntegrityError(
          `setupGame: conspiracy assignment for unknown seat ${slot.seat as unknown as number}`,
        );
      }
      const cmdZone = player.zones.get(ZoneType.Command);
      if (!cmdZone) {
        throw new GameStateIntegrityError(
          `setupGame: seat ${player.seat as unknown as number} missing Command zone for Conspiracy`,
        );
      }
      const card = game.cards.get(slot.cardId);
      if (!card) {
        throw new GameStateIntegrityError(
          `setupGame: Conspiracy card id ${slot.cardId as unknown as number} not in game.cards`,
        );
      }
      // Defensive: pull the conspiracy out of the library if the caller
      // accidentally seeded it there. CR 901 keeps conspiracies entirely
      // outside the deck.
      const lib = player.zones.get(ZoneType.Library);
      if (lib) lib.remove(slot.cardId);
      cmdZone.add(slot.cardId);
      card.zone = ZoneType.Command;
      // Activate printed abilities. Conspiracies have no spell-cost
      // (`ManaCost:no cost`) and are never cast — they're revealed at
      // game start — so we skip activated/spell abilities and just bind
      // the trigger / static / replacement layers their printed text needs.
      card.activateTriggersFromDefinition(game);
      card.activateStaticsFromDefinition(game);
      card.activateReplacementsFromDefinition(game);
      // Wire the freshly-built statics into the static-effect registry by
      // replaying a None → Command zone transition through the standard
      // zone-activation discipline. Without this, intrinsicStatics is
      // populated but the registry never sees them (so layer/SBA queries
      // miss the conspiracy's continuous effects).
      onZoneChange(game, slot.cardId, ZoneType.None, ZoneType.Command);
    }
  }

  // Step 1f (CR 901): Planechase placement. For each declared seat, push
  // every `planarDeck` id into that seat's PlanarDeck zone (preserving
  // caller order — top-of-deck first) and place the `activePlane` in
  // seat 0's Command zone (shared-active-plane convention; the planar
  // die roll mutates this single slot for everyone). The active plane's
  // printed statics + triggers + replacements activate immediately so
  // continuous effects with `EffectZone$ Command` register with the
  // layer engine and triggers tagged `TriggerZones$ Command` fire from
  // the command zone for the duration of the plane's tenure. When the
  // plane is replaced (by a planeswalk roll), SP6's planar-die
  // orchestration is responsible for unbinding via the inverse zone-
  // change emission.
  const planechase = opts.planechase;
  if (planechase !== undefined) {
    // The shared active plane lives in seat 0's command zone by
    // convention. Multiple seats may carry planechase entries (each with
    // their own planar deck) but only the FIRST entry's `activePlane` is
    // promoted to the command zone — the others stage on top of their
    // own planar deck so a future planeswalk pops the right card.
    let activePlanePlaced = false;
    for (const slot of planechase) {
      const player = game.players.find((p) => p.seat === slot.seat);
      if (!player) {
        throw new GameStateIntegrityError(
          `setupGame: planechase assignment for unknown seat ${slot.seat as unknown as number}`,
        );
      }
      const planarZone = player.zones.get(ZoneType.PlanarDeck);
      if (!planarZone) {
        throw new GameStateIntegrityError(
          `setupGame: seat ${player.seat as unknown as number} missing PlanarDeck zone`,
        );
      }
      // Seed the planar deck. Cards must already exist in game.cards;
      // their .zone pointer is rewritten to PlanarDeck so zone queries
      // return the right answer.
      for (const id of slot.planarDeck) {
        const c = game.cards.get(id);
        if (!c) {
          throw new GameStateIntegrityError(
            `setupGame: planar-deck card id ${id as unknown as number} not in game.cards`,
          );
        }
        planarZone.add(id);
        c.zone = ZoneType.PlanarDeck;
      }
      // The first planechase slot owns the shared active plane. Place
      // it in seat 0's command zone, activate its abilities, and replay
      // the None → Command transition so the static-effect registry
      // sees the plane's continuous statics.
      if (!activePlanePlaced) {
        const seat0 = game.players[0];
        if (!seat0) {
          throw new GameStateIntegrityError(
            "setupGame: planechase requires at least one player at seat 0 for the active plane",
          );
        }
        const seat0Cmd = seat0.zones.get(ZoneType.Command);
        if (!seat0Cmd) {
          throw new GameStateIntegrityError(
            "setupGame: seat 0 missing Command zone for Planechase active plane",
          );
        }
        const planeCard = game.cards.get(slot.activePlane);
        if (!planeCard) {
          throw new GameStateIntegrityError(
            `setupGame: active-plane card id ${slot.activePlane as unknown as number} not in game.cards`,
          );
        }
        // Defensive: pull the active plane out of the planar deck if the
        // caller seeded it there (CR 901 keeps the active plane and the
        // planar deck disjoint).
        planarZone.remove(slot.activePlane);
        seat0Cmd.add(slot.activePlane);
        planeCard.zone = ZoneType.Command;
        // Activate the plane's printed abilities. Planes are never cast
        // (`ManaCost:no cost`), so we skip activated/spell abilities and
        // bind only the trigger / static / replacement layers their
        // printed text needs — same pattern as Conspiracy.
        planeCard.activateTriggersFromDefinition(game);
        planeCard.activateStaticsFromDefinition(game);
        planeCard.activateReplacementsFromDefinition(game);
        // Hand-off to the static-effect registry via the standard zone-
        // activation discipline. Without this, intrinsicStatics is
        // populated but the registry never sees the plane's continuous
        // statics — layer/SBA queries would miss them.
        onZoneChange(game, slot.activePlane, ZoneType.None, ZoneType.Command);
        activePlanePlaced = true;
      }
    }
  }

  // Step 1g (CR 904): Archenemy placement. For each declared seat, set
  // the archenemy's life to the requested startingLife (default 40 per
  // CR 904.5) and seed the schemeDeck ids into that seat's SchemeDeck
  // zone in caller order (top-of-deck first). Schemes are NOT activated
  // here — they stay hidden in the SchemeDeck until GameAction.setInMotion
  // pops the top, places it in the Command zone, and fires its triggers.
  //
  // Why pop-on-demand instead of pre-activating: setInMotion is the
  // canonical lifecycle entry for a scheme — the SchemeSetInMotion event
  // it emits is what `T:Mode$ SetInMotion` triggers match against. If we
  // activated triggers at setup time, the trigger would fire once when
  // the scheme moved out of SchemeDeck (and never again). Forge keeps
  // schemes asleep until set in motion; we mirror that.
  const archenemy = opts.archenemy;
  if (archenemy !== undefined) {
    for (const slot of archenemy) {
      const player = game.players.find((p) => p.seat === slot.seat);
      if (!player) {
        throw new GameStateIntegrityError(
          `setupGame: archenemy assignment for unknown seat ${slot.seat as unknown as number}`,
        );
      }
      const schemeZone = player.zones.get(ZoneType.SchemeDeck);
      if (!schemeZone) {
        throw new GameStateIntegrityError(
          `setupGame: seat ${player.seat as unknown as number} missing SchemeDeck zone`,
        );
      }
      // Apply the archenemy's starting life — defaults to 40 per CR
      // 904.5. Direct assignment is correct here: setupGame runs before
      // any life-change replacements latch (apply-loop is idle), and
      // the variant-mandated life total is a setup-time property, not
      // a gameable life-change event.
      player.life = slot.startingLife ?? 40;
      // Seed the scheme deck. Cards must already exist in game.cards;
      // their .zone pointer is rewritten to SchemeDeck so zone queries
      // return the right answer.
      for (const id of slot.schemeDeck) {
        const c = game.cards.get(id);
        if (!c) {
          throw new GameStateIntegrityError(
            `setupGame: scheme card id ${id as unknown as number} not in game.cards`,
          );
        }
        // Defensive: pull the scheme out of the library if the caller
        // accidentally seeded it there (CR 904 keeps schemes strictly
        // outside the 60-card deck).
        const lib = player.zones.get(ZoneType.Library);
        if (lib) lib.remove(id);
        schemeZone.add(id);
        c.zone = ZoneType.SchemeDeck;
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

  // Step 3: draw starting hands. Per-player effective starting hand size
  // honours `Player.startingHandSizeMod` — set by `S:Mode$
  // StartingHandSizeMod` statics and by Vanguard avatars (CR 902).
  const handSizes = new Map<PlayerSeat, number>();
  for (const player of game.players) {
    const eff = effectiveStartingHandSize(player, game.rules.startingHandSize);
    handSizes.set(player.seat, eff);
  }
  for (const player of game.players) {
    yield* action.drawCards(player.seat, handSizes.get(player.seat) ?? game.rules.startingHandSize);
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
            handBefore: handSizes.get(player.seat) ?? game.rules.startingHandSize,
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
      yield* action.drawCards(player.seat, handSizes.get(player.seat) ?? game.rules.startingHandSize);
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
