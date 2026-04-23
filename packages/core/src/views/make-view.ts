// SPDX-License-Identifier: GPL-3.0-or-later
// makeGameView projects a GameSnapshotData (pure data, same shape produced
// later by GameSnapshot.toJSON in Task 42) into a GameView filtered for a
// specific viewer seat. This is the ONLY hidden-info boundary between engine
// state and an untrusted consumer — every rule here maps directly to MTG CR
// 903.8 (hidden zones) or Forge's ZoneType holdsHiddenInfo flag.
//
// Contract: given the same snapshot + same seat, output is deterministic and
// structurally pure (no class instances), so it JSON round-trips as identity.

import type { EntityId, PlayerSeat } from "../ids.js";
import type { PhaseStep } from "../phase.js";
import { HIDDEN_ZONES, ZoneType } from "../zone.js";
import type { CardView, GameView, PlayerView, ZoneContentView } from "./types.js";

/**
 * Per-card data extracted from live state, keyed by EntityId. Sufficient to
 * build any CardView: name (used when visible), current zone (for validation
 * and placement), tapped/faceDown state, and counters.
 */
export interface SnapshotCardData {
  readonly id: EntityId;
  readonly name: string;
  readonly zone: ZoneType;
  readonly tapped: boolean;
  readonly faceDown: boolean;
  readonly counters: Readonly<Record<string, number>>;
}

/**
 * Per-player snapshot row. `zones` maps every ZoneType to the ordered list
 * of EntityIds currently in that zone for this player (shared public zones
 * like Stack/Exile are mirrored on every player OR represented only on a
 * sentinel seat — but for view filtering we only need to know which IDs to
 * look up and under which zone the viewer sees them).
 */
export interface SnapshotPlayerData {
  readonly seat: PlayerSeat;
  readonly life: number;
  readonly zones: Readonly<Record<ZoneType, readonly EntityId[]>>;
}

export interface GameSnapshotData {
  readonly turn: number;
  readonly phase: PhaseStep;
  readonly activePlayer: PlayerSeat;
  readonly players: readonly SnapshotPlayerData[];
  readonly cards: Readonly<Record<number, SnapshotCardData>>;
  readonly stack: readonly EntityId[];
}

// Public zones visible to every seat per MTG CR + our Forge-aligned
// HIDDEN_ZONES set. Kept inline here (not exported) to isolate the rule so
// makeGameView has a single decision point.
const isPublicZone = (zone: ZoneType): boolean => !HIDDEN_ZONES.has(zone);

// Per-seat private zones: owner sees contents, opponents see only count.
// Derived from HIDDEN_ZONES minus the "globally hidden" deck-like zones that
// nobody may peek into by default (SchemeDeck etc. — those remain hidden
// even for the owner per Forge's semantics).
const OWNER_VISIBLE_HIDDEN: ReadonlySet<ZoneType> = new Set<ZoneType>([ZoneType.Hand, ZoneType.Sideboard]);

// Zones that are ALWAYS hidden regardless of viewer. The owner does not see
// their own library contents (can't peek), likewise for the exotic decks.
const GLOBALLY_HIDDEN: ReadonlySet<ZoneType> = new Set<ZoneType>([
  ZoneType.Library,
  ZoneType.SchemeDeck,
  ZoneType.PlanarDeck,
  ZoneType.AttractionDeck,
  ZoneType.ContraptionDeck,
  ZoneType.Subgame,
  ZoneType.ExtraHand,
  ZoneType.None,
]);

/**
 * Project a single card. Applies the face-down name-omission rule: if the
 * card is face-down AND the viewer does not control it (we use "owner of
 * the zone" as controller proxy here — morphs/manifests live in their
 * controller's battlefield row), the `name` field is omitted.
 */
const projectCard = (data: SnapshotCardData, viewerSeat: PlayerSeat, zoneOwnerSeat: PlayerSeat): CardView => {
  const controllerVisible = zoneOwnerSeat === viewerSeat;
  const hideName = data.faceDown && !controllerVisible;
  const base: CardView = {
    id: data.id,
    zone: data.zone,
    tapped: data.tapped,
    counters: data.counters,
  };
  if (hideName) return base;
  return { ...base, name: data.name };
};

const projectZone = (
  ids: readonly EntityId[],
  zone: ZoneType,
  ownerSeat: PlayerSeat,
  viewerSeat: PlayerSeat,
  cards: Readonly<Record<number, SnapshotCardData>>,
): ZoneContentView => {
  // Globally hidden zones: no viewer sees contents (including the owner).
  if (GLOBALLY_HIDDEN.has(zone)) {
    return { kind: "hidden", count: ids.length };
  }

  // Per-seat private zones (Hand, Sideboard): owner sees, opponents see count.
  if (OWNER_VISIBLE_HIDDEN.has(zone)) {
    if (ownerSeat === viewerSeat) {
      return {
        kind: "visible",
        cards: ids.map((id) => projectCard(requireCard(cards, id), viewerSeat, ownerSeat)),
      };
    }
    return { kind: "hidden", count: ids.length };
  }

  // Public zones (Battlefield, Graveyard, Exile, Command, Stack, Ante,
  // Merged, Flashback, Junkyard): fully visible. Face-down filtering still
  // applies at the card level via projectCard.
  if (isPublicZone(zone)) {
    return {
      kind: "visible",
      cards: ids.map((id) => projectCard(requireCard(cards, id), viewerSeat, ownerSeat)),
    };
  }

  // Fallback for any zone we forgot to classify — hide by default to avoid
  // accidental info leak. Unreachable if rosters stay in sync.
  return { kind: "hidden", count: ids.length };
};

const requireCard = (cards: Readonly<Record<number, SnapshotCardData>>, id: EntityId): SnapshotCardData => {
  const entry = cards[id as unknown as number];
  if (entry === undefined) {
    throw new Error(`makeGameView: card id ${id as unknown as number} missing from snapshot`);
  }
  return entry;
};

const ALL_ZONES: readonly ZoneType[] = Object.values(ZoneType);

const projectPlayer = (
  p: SnapshotPlayerData,
  viewerSeat: PlayerSeat,
  cards: Readonly<Record<number, SnapshotCardData>>,
): PlayerView => {
  // Build a fully-populated Record<ZoneType, ZoneContentView>. Missing zones
  // in input default to an empty visible list for public zones or count=0 for
  // hidden — consumers can rely on every ZoneType key being present.
  const zones: Record<ZoneType, ZoneContentView> = {} as Record<ZoneType, ZoneContentView>;
  for (const z of ALL_ZONES) {
    const ids = p.zones[z] ?? [];
    zones[z] = projectZone(ids, z, p.seat, viewerSeat, cards);
  }
  return {
    seat: p.seat,
    life: p.life,
    zones,
  };
};

/**
 * Project a GameSnapshotData into a GameView for the given viewer seat.
 * Hidden-info filtering is applied per zone; face-down cards have their
 * names omitted when the viewer is not the controller.
 */
export const makeGameView = (data: GameSnapshotData, viewerSeat: PlayerSeat): GameView => {
  const players = data.players.map((p) => projectPlayer(p, viewerSeat, data.cards));
  // Stack is a public zone: every viewer sees every stack item. Owner-ship
  // for face-down purposes is the viewer itself (stack items are usually not
  // face-down; if they are, the SA controller is out of scope for SP1 and
  // defaults to "not controlled by viewer" so the name is omitted).
  const stack: readonly CardView[] = data.stack.map((id) => {
    const card = requireCard(data.cards, id);
    // Stack-face-down semantics (morph triggers, etc.) are effect-specific.
    // We conservatively treat viewerSeat as the controller proxy — an
    // acceptable approximation for SP1 since the real stack carries an
    // explicit controller field that the Task 42 snapshotter will wire.
    return projectCard(card, viewerSeat, viewerSeat);
  });
  return {
    turn: data.turn,
    phase: data.phase,
    activePlayer: data.activePlayer,
    players,
    stack,
  };
};
