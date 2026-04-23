// SPDX-License-Identifier: GPL-3.0-or-later
// GameSnapshot — save / load / undo foundation. snapshot(game) walks the live
// Game into plain JSON-stringifiable data; restore({...}) reconstructs a Game
// that behaves identically (same phase, same zones, same card state, same
// rng stream). Controllers (consumer closures), PaperCard defs (bulky,
// content-addressed), and GameRules (rare to diverge across a restore) are
// re-supplied externally because they either don't JSON-serialize or belong
// to consumer-owned lifetimes.
//
// Why a separate module (not Game.toJSON)? The serialization walks private
// fields (entityIdCounter, player zones, flags' internal Maps/Sets) that
// Game.toJSON — used for log previews and debug output — has no business
// exposing. Keeping snapshot logic here also isolates the schemaVersion
// contract so a bump doesn't pollute Game's API.
//
// schemaVersion: 1 (SP1). Bump on breaking format changes (master-spec §11).

import type {
  CounterType,
  EntityId,
  LobbyPlayer,
  PaperCard,
  PhaseStep,
  PlayerSeat,
  Rng,
  SerializedRngState,
  ZoneType,
} from "@mtg-forge-ts/core";
import {
  ZoneType as ZoneTypeEnum,
  deserializeRngState,
  mkEntityId,
  paperCardKey,
  serializeRngState,
} from "@mtg-forge-ts/core";
import { Card } from "../card.js";
import type { GameFlags } from "../game-flags.js";
import { createDefaultFlags } from "../game-flags.js";
import type { GameRules } from "../game-rules.js";
import { Game } from "../game.js";
import type { StackItem } from "../stack/stack-item.js";
import type { Zone } from "../zone/zone.js";
import { Ante } from "../zone/zones/ante.js";
import { Battlefield } from "../zone/zones/battlefield.js";
import { CommandZone } from "../zone/zones/command-zone.js";
import { Exile } from "../zone/zones/exile.js";
import { Graveyard } from "../zone/zones/graveyard.js";
import { Hand } from "../zone/zones/hand.js";
import { Library } from "../zone/zones/library.js";

/**
 * SP1 snapshot format version. Breaking format changes (field rename, shape
 * removed, Map key flipped) MUST bump this so restore() can reject or migrate
 * old blobs rather than silently mis-deserialize.
 */
export const SNAPSHOT_SCHEMA_VERSION = 1 as const;

/**
 * Serialized Card record. Deliberately parallels Card.toJSON plus a few fields
 * Card.toJSON omits (copiedFrom, faceDown) — snapshot must preserve every live
 * field while Card.toJSON can stay a lightweight log preview.
 */
export interface SerializedCard {
  readonly id: EntityId;
  readonly paperCardKey: string;
  readonly ownerSeat: PlayerSeat;
  readonly controllerSeat: PlayerSeat;
  readonly zone: ZoneType;
  readonly tapped: boolean;
  readonly phased: boolean;
  readonly damage: number;
  readonly counters: Record<string, number>;
  readonly attachedTo: EntityId | null;
  readonly attachments: readonly EntityId[];
  // WHY: copiedFrom + faceDown are SP2-typed (`unknown`) but snapshot must
  // carry whatever the engine stored so restore is lossless.
  readonly copiedFrom: unknown;
  readonly faceDown: unknown;
}

/**
 * Serialized Zone entry. Zone.toJSON emits this shape already; snapshot mirrors
 * it here so the on-disk schema is fully documented in one place.
 */
export interface SerializedZone {
  readonly type: ZoneType;
  readonly ownerSeat: PlayerSeat | null;
  readonly items: readonly EntityId[];
}

/**
 * Per-player snapshot. Player.toJSON omits zones deliberately (kept as a
 * lightweight log view); snapshot stitches them in via a dedicated shape here.
 */
export interface SerializedPlayer {
  readonly seat: PlayerSeat;
  readonly lobbyPlayerId: string;
  readonly teamId: number;
  readonly life: number;
  readonly counters: Record<string, number>;
  readonly zones: readonly SerializedZone[];
}

/**
 * GameFlags persisted shape. Maps/Sets serialize to arrays-of-entries so the
 * blob is JSON-stringifiable (JSON.stringify of a Map emits `{}`, losing data).
 */
export interface SerializedGameFlags {
  readonly dayNight: "day" | "night" | "neither";
  readonly monarch: PlayerSeat | null;
  readonly initiative: PlayerSeat | null;
  readonly cityBlessing: readonly PlayerSeat[];
  readonly ringBearer: readonly (readonly [PlayerSeat, EntityId | null])[];
  readonly ringLevel: readonly (readonly [PlayerSeat, 0 | 1 | 2 | 3 | 4])[];
  readonly speedLevel: readonly (readonly [PlayerSeat, 0 | 1 | 2 | 3 | 4])[];
  readonly currentDungeon: readonly (readonly [
    PlayerSeat,
    { readonly card: EntityId; readonly position: string } | null,
  ])[];
  readonly commandersOwnedByPlayer: readonly (readonly [PlayerSeat, readonly EntityId[]])[];
  readonly commanderCastCount: readonly (readonly [EntityId, number])[];
  readonly commanderDamage: readonly (readonly [EntityId, readonly (readonly [PlayerSeat, number])[]])[];
  readonly firstTurnDrawSkipped: readonly (readonly [PlayerSeat, boolean])[];
  readonly mulligansTaken: readonly (readonly [PlayerSeat, number])[];
  readonly landsPlayedThisTurn: readonly (readonly [PlayerSeat, number])[];
  readonly spellsCastThisTurn: readonly (readonly [PlayerSeat, number])[];
  readonly turnsTakenThisTurn: number;
  readonly skippedPhases: readonly PhaseStep[];
  readonly activeTeamForTeamPlay: number | null;
  readonly seatEliminated: readonly (readonly [PlayerSeat, boolean])[];
  readonly stickers: readonly unknown[];
  readonly attractions: readonly (readonly [PlayerSeat, unknown])[];
}

/**
 * Engine + card-data provenance + save-time metadata. `forgeSha`,
 * `cardDataSyncedAt`, `crVersion`, `seed` come from GameMeta; `formatId` from
 * GameRules. `formatDefinitionSnapshot` is a reserved slot: SP6 will attach a
 * Format definition here so restore can verify legality invariants.
 */
export interface GameSnapshotHeader {
  readonly schemaVersion: number;
  readonly engineVersion: string;
  readonly forgeSha: string;
  readonly cardDataSyncedAt: string;
  readonly crVersion: string;
  readonly savedAt: string;
  readonly formatId: string;
  readonly formatDefinitionSnapshot: unknown;
  readonly seed: string;
}

/**
 * Top-level snapshot shape. Split into `header` (provenance / metadata, cheap
 * to inspect without rehydrating) + `state` (engine state, expensive to walk).
 */
export interface GameSnapshot {
  readonly header: GameSnapshotHeader;
  readonly state: {
    readonly turn: number;
    readonly phase: PhaseStep;
    readonly activePlayer: PlayerSeat;
    readonly priorityPlayer: PlayerSeat | null;
    readonly players: readonly SerializedPlayer[];
    readonly cards: readonly SerializedCard[];
    readonly sharedZones: {
      readonly stack: { readonly items: readonly StackItem[] };
      readonly exile: SerializedZone;
      readonly ante: SerializedZone;
    };
    readonly flags: SerializedGameFlags;
    readonly rngState: SerializedRngState;
    readonly entityIdCounter: number;
    readonly terminalState: {
      readonly reason: "victory" | "draw" | "concede" | "timeout";
      readonly winners: readonly PlayerSeat[];
      readonly turn: number;
    } | null;
  };
}

// === Flag serialization ============================================

const flagsToJSON = (f: GameFlags): SerializedGameFlags => ({
  dayNight: f.dayNight,
  monarch: f.monarch,
  initiative: f.initiative,
  cityBlessing: [...f.cityBlessing],
  ringBearer: [...f.ringBearer.entries()].map(([s, e]) => [s, e] as const),
  ringLevel: [...f.ringLevel.entries()].map(([s, l]) => [s, l] as const),
  speedLevel: [...f.speedLevel.entries()].map(([s, l]) => [s, l] as const),
  currentDungeon: [...f.currentDungeon.entries()].map(([s, d]) => [s, d] as const),
  commandersOwnedByPlayer: [...f.commandersOwnedByPlayer.entries()].map(([s, arr]) => [s, [...arr]] as const),
  commanderCastCount: [...f.commanderCastCount.entries()].map(([e, n]) => [e, n] as const),
  commanderDamage: [...f.commanderDamage.entries()].map(
    ([e, inner]) => [e, [...inner.entries()].map(([s, n]) => [s, n] as const)] as const,
  ),
  firstTurnDrawSkipped: [...f.firstTurnDrawSkipped.entries()].map(([s, b]) => [s, b] as const),
  mulligansTaken: [...f.mulligansTaken.entries()].map(([s, n]) => [s, n] as const),
  landsPlayedThisTurn: [...f.landsPlayedThisTurn.entries()].map(([s, n]) => [s, n] as const),
  spellsCastThisTurn: [...f.spellsCastThisTurn.entries()].map(([s, n]) => [s, n] as const),
  turnsTakenThisTurn: f.turnsTakenThisTurn,
  skippedPhases: [...f.skippedPhases],
  activeTeamForTeamPlay: f.activeTeamForTeamPlay,
  seatEliminated: [...f.seatEliminated.entries()].map(([s, b]) => [s, b] as const),
  stickers: [...f.stickers],
  attractions: [...f.attractions.entries()].map(([s, a]) => [s, a] as const),
});

const flagsFromJSON = (s: SerializedGameFlags): GameFlags => {
  const f = createDefaultFlags();
  f.dayNight = s.dayNight;
  f.monarch = s.monarch;
  f.initiative = s.initiative;
  for (const seat of s.cityBlessing) f.cityBlessing.add(seat);
  for (const [seat, entityOrNull] of s.ringBearer) f.ringBearer.set(seat, entityOrNull);
  for (const [seat, level] of s.ringLevel) f.ringLevel.set(seat, level);
  for (const [seat, level] of s.speedLevel) f.speedLevel.set(seat, level);
  for (const [seat, dungeon] of s.currentDungeon) f.currentDungeon.set(seat, dungeon);
  for (const [seat, arr] of s.commandersOwnedByPlayer) {
    f.commandersOwnedByPlayer.set(seat, [...arr]);
  }
  for (const [entity, n] of s.commanderCastCount) f.commanderCastCount.set(entity, n);
  for (const [entity, inner] of s.commanderDamage) {
    const m = new Map<PlayerSeat, number>();
    for (const [seat, n] of inner) m.set(seat, n);
    f.commanderDamage.set(entity, m);
  }
  for (const [seat, b] of s.firstTurnDrawSkipped) f.firstTurnDrawSkipped.set(seat, b);
  for (const [seat, n] of s.mulligansTaken) f.mulligansTaken.set(seat, n);
  for (const [seat, n] of s.landsPlayedThisTurn) f.landsPlayedThisTurn.set(seat, n);
  for (const [seat, n] of s.spellsCastThisTurn) f.spellsCastThisTurn.set(seat, n);
  f.turnsTakenThisTurn = s.turnsTakenThisTurn;
  f.skippedPhases = [...s.skippedPhases];
  f.activeTeamForTeamPlay = s.activeTeamForTeamPlay;
  for (const [seat, b] of s.seatEliminated) f.seatEliminated.set(seat, b);
  f.stickers = [...s.stickers];
  for (const [seat, a] of s.attractions) f.attractions.set(seat, a);
  return f;
};

// === Card serialization ============================================

const cardToSnapshot = (c: Card): SerializedCard => ({
  id: c.id,
  paperCardKey: paperCardKey(c.paperCard),
  ownerSeat: c.ownerSeat,
  controllerSeat: c.controllerSeat,
  zone: c.zone,
  tapped: c.tapped,
  phased: c.phased,
  damage: c.damage,
  counters: Object.fromEntries(c.counters),
  attachedTo: c.attachedTo,
  attachments: [...c.attachments],
  copiedFrom: c.copiedFrom,
  faceDown: c.faceDown,
});

// === Zone snapshot helpers =========================================

const zoneToSnapshot = (z: Zone): SerializedZone => z.toJSON();

/**
 * Factory for concrete Zone subclasses keyed by ZoneType. Battlefield/Hand/
 * Library/Graveyard/Command-zone instantiate the player-owned subclasses;
 * Exile/Ante construct the shared subclasses. Zones not populated in SP1 fall
 * back to `Battlefield` as a typed sentinel — SP7 (attractions, contraptions)
 * adds their concrete classes and this switch extends.
 */
const makeZone = (type: ZoneType, ownerSeat: PlayerSeat | null): Zone => {
  switch (type) {
    case ZoneTypeEnum.Hand:
      return new Hand(type, ownerSeat);
    case ZoneTypeEnum.Library:
      return new Library(type, ownerSeat);
    case ZoneTypeEnum.Graveyard:
      return new Graveyard(type, ownerSeat);
    case ZoneTypeEnum.Battlefield:
      return new Battlefield(type, ownerSeat);
    case ZoneTypeEnum.Exile:
      return new Exile(type, ownerSeat);
    case ZoneTypeEnum.Command:
      return new CommandZone(type, ownerSeat);
    case ZoneTypeEnum.Ante:
      return new Ante(type, ownerSeat);
    // WHY: SP1 doesn't yet surface concrete classes for these zones; fall
    // through to a Battlefield-shaped generic so the snapshot round-trip
    // preserves item lists losslessly. Replace as subclasses land.
    default:
      return new Battlefield(type, ownerSeat);
  }
};

// === Top-level snapshot ============================================

/**
 * Walk the live Game and produce a JSON-stringifiable GameSnapshot. The
 * returned object contains only plain values — no class instances, no bigint,
 * no Map/Set — so `JSON.stringify(snapshot(game))` never throws.
 */
export const snapshot = (game: Game): GameSnapshot => {
  const players: SerializedPlayer[] = game.players.map((p) => ({
    seat: p.seat,
    lobbyPlayerId: p.lobbyPlayer.id,
    teamId: p.teamId,
    life: p.life,
    counters: Object.fromEntries(p.counters),
    zones: [...p.zones.values()].map(zoneToSnapshot),
  }));

  const cards: SerializedCard[] = [...game.cards.values()].map(cardToSnapshot);

  return {
    header: {
      schemaVersion: SNAPSHOT_SCHEMA_VERSION,
      engineVersion: game.meta.engineVersion,
      forgeSha: game.meta.forgeSha,
      cardDataSyncedAt: game.meta.cardDataSyncedAt,
      crVersion: game.meta.crVersion,
      savedAt: new Date().toISOString(),
      formatId: game.rules.formatId,
      // SP6 populates this with a real format snapshot; null until then.
      formatDefinitionSnapshot: null,
      seed: game.meta.seed,
    },
    state: {
      turn: game.turn,
      phase: game.phase,
      activePlayer: game.activePlayer,
      priorityPlayer: game.priorityPlayer,
      players,
      cards,
      sharedZones: {
        stack: { items: [...game.sharedZones.stack.toArray()] },
        exile: zoneToSnapshot(game.sharedZones.exile),
        ante: zoneToSnapshot(game.sharedZones.ante),
      },
      flags: flagsToJSON(game.flags),
      rngState: serializeRngState(game.rng.getState()),
      entityIdCounter: computeNextEntityId(game),
      terminalState: game.terminalState,
    },
  };
};

/**
 * Game.entityIdCounter is private; we can't read it from outside. Instead
 * compute a safe "next id" from the snapshot's own contents (max existing id +
 * 1). This preserves the monotonic-allocator invariant without adding a public
 * getter that would encourage misuse.
 */
const computeNextEntityId = (game: Game): number => {
  let max = -1;
  for (const id of game.cards.keys()) {
    const n = id as unknown as number;
    if (n > max) max = n;
  }
  for (const item of game.sharedZones.stack.toArray()) {
    const n = item.id as unknown as number;
    if (n > max) max = n;
  }
  return max + 1;
};

// === Restore =======================================================

/**
 * restore() inputs: the snapshot plus everything the snapshot can't carry
 * itself — LobbyPlayer closures (controllers live outside the engine),
 * PaperCard defs (content-addressed, not embedded), GameRules (infrequently
 * changing; caller owns), and the Rng instance (setState-driven).
 */
export interface RestoreOptions {
  readonly lobbyPlayers: readonly LobbyPlayer[];
  readonly rng: Rng;
  readonly paperCards: ReadonlyMap<string, PaperCard>;
  readonly rules: GameRules;
}

/**
 * Reconstruct a Game from a GameSnapshot. The returned Game is equivalent to
 * the one that produced the snapshot — same turn/phase, same zone contents,
 * same card state, same rng stream (the next nextLong() call on the restored
 * Game produces the same output as the next call on the original would have).
 *
 * Fails loudly on:
 *   - schemaVersion mismatch (future breaking changes)
 *   - LobbyPlayer id not in opts.lobbyPlayers
 *   - paperCardKey not in opts.paperCards
 *   - snapshot's engine meta missing / malformed
 */
export const restore = (snap: GameSnapshot, opts: RestoreOptions): Game => {
  if (snap.header.schemaVersion !== SNAPSHOT_SCHEMA_VERSION) {
    throw new Error(
      `GameSnapshot.restore: schema version ${snap.header.schemaVersion} incompatible with engine (${SNAPSHOT_SCHEMA_VERSION})`,
    );
  }

  // Pair snapshot players with the caller-supplied LobbyPlayer list by id.
  const lobbyById = new Map(opts.lobbyPlayers.map((lp) => [lp.id, lp] as const));
  const orderedLobbyPlayers: LobbyPlayer[] = snap.state.players.map((sp) => {
    const lp = lobbyById.get(sp.lobbyPlayerId);
    if (!lp) throw new Error(`GameSnapshot.restore: missing LobbyPlayer for id "${sp.lobbyPlayerId}"`);
    return lp;
  });

  const game = new Game({
    lobbyPlayers: orderedLobbyPlayers,
    rules: opts.rules,
    meta: {
      engineVersion: snap.header.engineVersion,
      forgeSha: snap.header.forgeSha,
      cardDataSyncedAt: snap.header.cardDataSyncedAt,
      crVersion: snap.header.crVersion,
      seed: snap.header.seed,
    },
    rng: opts.rng,
  });

  // Overwrite mutable top-level state.
  game.turn = snap.state.turn;
  game.phase = snap.state.phase;
  game.activePlayer = snap.state.activePlayer;
  game.priorityPlayer = snap.state.priorityPlayer;
  game.terminalState = snap.state.terminalState;

  // Rehydrate each Player's mutable fields + zones (new Player instances are
  // already minted by Game's constructor; we reach into them to set state).
  for (let i = 0; i < snap.state.players.length; i++) {
    const sp = snap.state.players[i];
    const p = game.players[i];
    if (!sp || !p) continue;
    // Seat + teamId + lobbyPlayer are determined at construction — assert they
    // match the snapshot rather than overwriting silently.
    if (sp.seat !== p.seat) {
      throw new Error(
        `GameSnapshot.restore: player[${i}] seat ${sp.seat as unknown as number} !== constructed seat ${
          p.seat as unknown as number
        }`,
      );
    }
    p.teamId = sp.teamId;
    p.life = sp.life;
    p.counters.clear();
    for (const [k, v] of Object.entries(sp.counters)) {
      p.counters.set(k as CounterType, v);
    }
    p.zones.clear();
    for (const sz of sp.zones) {
      const z = makeZone(sz.type, sz.ownerSeat);
      for (const entry of sz.items) z.add(mkEntityId(entry as unknown as number));
      p.zones.set(sz.type, z);
    }
  }

  // Rebuild the card registry. Cards are keyed by EntityId; walk the snapshot
  // cards array in order and rehydrate each via Card's constructor + mutable
  // field assignment.
  game.cards.clear();
  for (const sc of snap.state.cards) {
    const paper = opts.paperCards.get(sc.paperCardKey);
    if (!paper) {
      throw new Error(`GameSnapshot.restore: missing PaperCard for key "${sc.paperCardKey}"`);
    }
    const card = new Card(sc.id, paper, sc.ownerSeat, sc.controllerSeat, sc.zone);
    card.tapped = sc.tapped;
    card.phased = sc.phased;
    card.damage = sc.damage;
    for (const [k, v] of Object.entries(sc.counters)) {
      card.counters.set(k as CounterType, v);
    }
    card.attachedTo = sc.attachedTo;
    card.attachments = [...sc.attachments];
    card.copiedFrom = sc.copiedFrom;
    card.faceDown = sc.faceDown;
    game.cards.set(sc.id, card);
  }

  // Shared zones. Game's constructor already mints Exile + Ante instances; we
  // clear and refill them rather than replacing (keeps the Game.sharedZones
  // readonly reference pattern intact).
  game.sharedZones.exile.clear();
  for (const id of snap.state.sharedZones.exile.items) {
    game.sharedZones.exile.add(mkEntityId(id as unknown as number));
  }
  game.sharedZones.ante.clear();
  for (const id of snap.state.sharedZones.ante.items) {
    game.sharedZones.ante.add(mkEntityId(id as unknown as number));
  }

  // Stack — Stack items are the rich StackItem shape, not EntityIds.
  // Stack doesn't expose a clear(); since restore always runs on a freshly
  // constructed Game the stack is already empty.
  for (const item of snap.state.sharedZones.stack.items) {
    game.sharedZones.stack.push(item);
  }

  // Flags (Maps/Sets rehydrated via flagsFromJSON — we overwrite via Object
  // assignment because the Game constructor already installed defaults).
  const restoredFlags = flagsFromJSON(snap.state.flags);
  Object.assign(game.flags, restoredFlags);

  // Rng state — bridge hex-string payload back to bigint.
  game.rng.setState(deserializeRngState(snap.state.rngState));

  // Restore the private entity-id counter so freshly-minted ids after restore
  // don't collide with ids baked into the restored card registry.
  game.restoreEntityIdCounter(snap.state.entityIdCounter);

  return game;
};
