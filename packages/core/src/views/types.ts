// SPDX-License-Identifier: GPL-3.0-or-later
// Read-only view projections of game state for consumers (UIs, AIs, network
// peers). These types are the contract between the engine and a viewer —
// hidden-info filtering in makeGameView is the ONLY place where opponent-
// private state is redacted, so these interfaces must never expose a channel
// for leaking EntityIds or names through optional fields when hidden.

import type { EntityId, PlayerSeat } from "../ids.js";
import type { PhaseStep } from "../phase.js";
import type { ZoneType } from "../zone.js";

/**
 * A card as visible to a specific viewer. `name` is omitted when the card is
 * face-down AND the viewer is not the card's controller (morph/manifest seen
 * by an opponent). `tapped` and `counters` are always present when the card
 * itself is visible — they describe public, non-identity state.
 */
export interface CardView {
  readonly id: EntityId;
  readonly name?: string;
  readonly zone: ZoneType;
  readonly tapped?: boolean;
  readonly counters?: Readonly<Record<string, number>>;
}

/**
 * Content of a single zone as visible to a viewer. Three kinds:
 *   - visible: full card list (public zones, own hidden zones).
 *   - hidden: only the count leaks (opponent hand, any library, etc.).
 *   - partiallyVisible: mixed — some cards revealed (e.g. a Scry'd top of
 *     library that the viewer was shown), others hidden.
 */
export type ZoneContentView =
  | { readonly kind: "visible"; readonly cards: readonly CardView[] }
  | { readonly kind: "hidden"; readonly count: number }
  | { readonly kind: "partiallyVisible"; readonly cards: readonly CardView[]; readonly hiddenCount: number };

export interface PlayerView {
  readonly seat: PlayerSeat;
  readonly life: number;
  readonly zones: Readonly<Record<ZoneType, ZoneContentView>>;
}

export interface GameView {
  readonly turn: number;
  readonly phase: PhaseStep;
  readonly activePlayer: PlayerSeat;
  readonly players: readonly PlayerView[];
  readonly stack: readonly CardView[];
}
