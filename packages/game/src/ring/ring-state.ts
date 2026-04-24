// SPDX-License-Identifier: GPL-3.0-or-later
// CR 701.52 — "The Ring tempts you". Per-player Ring state tracks the
// current Ring-bearer (a creature the player controls, or null if none)
// and the Ring's level (0-4). Level 0 = the player has never been tempted;
// levels 1-4 grant cumulative abilities to the bearer (Task 63).
//
// The engine holds Ring state on Game.ringState (Map<PlayerSeat, RingState>)
// rather than on Player — players may not be tempted; keeping the map
// sparse avoids spurious state on every player.
import type { EntityId } from "@mtg-forge-ts/core";

export type RingLevel = 0 | 1 | 2 | 3 | 4;

export interface RingState {
  readonly bearer: EntityId | null;
  readonly level: RingLevel;
}

export const INITIAL_RING_STATE: RingState = { bearer: null, level: 0 };
