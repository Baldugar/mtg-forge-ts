// SPDX-License-Identifier: GPL-3.0-or-later
// Discriminated union of every CR 704.5 state-based action. Tasks 30-32
// implement collection + application per kind. SbaEngine.sweep() collects
// and dispatches.
import type { EntityId, PlayerSeat } from "@mtg-forge-ts/core";

export type SbaAction =
  // CR 704.5a — player with 0 or less life loses
  | { readonly kind: "playerLosesLifeZero"; readonly seat: PlayerSeat }
  // CR 704.5c — player with 10+ poison counters loses
  | { readonly kind: "playerLosesPoison"; readonly seat: PlayerSeat; readonly poisonCount: number }
  // CR 704.5b — player who failed a draw loses
  | { readonly kind: "playerLosesEmptyDraw"; readonly seat: PlayerSeat }
  // CR 704.5f — creature with toughness <= 0 goes to graveyard
  | { readonly kind: "creatureZeroToughness"; readonly cardId: EntityId }
  // CR 704.5g — creature with damage >= toughness (and not indestructible) destroyed
  | { readonly kind: "creatureLethalDamage"; readonly cardId: EntityId }
  // CR 704.5i — planeswalker with 0 loyalty goes to graveyard
  | { readonly kind: "planeswalkerZeroLoyalty"; readonly cardId: EntityId }
  // CR 704.5s — battle with 0 defense counters exiled
  | { readonly kind: "battleZeroDefense"; readonly cardId: EntityId }
  // CR 704.5j — legend rule: legendaries with the same name, same controller
  | {
      readonly kind: "legendRule";
      readonly controllerSeat: PlayerSeat;
      readonly candidateIds: readonly EntityId[];
    }
  // CR 704.5k — world rule: only the most-recent World permanent stays
  | { readonly kind: "worldRule"; readonly cardIds: readonly EntityId[] }
  // CR 704.5d — token in non-battlefield zone ceases to exist
  | { readonly kind: "tokenCeaseExistence"; readonly cardId: EntityId }
  // CR 704.5e — copy in non-battlefield zone reverts (clear copiedFrom)
  | { readonly kind: "copyRevert"; readonly cardId: EntityId }
  // CR 702.26c — phased-out permanent whose owner leaves the game leaves too
  | { readonly kind: "phasedOutOwnerLeaves"; readonly cardId: EntityId }
  // CR 704.5n — aura on invalid object (or nothing) goes to graveyard
  | { readonly kind: "auraUnattachedInvalid"; readonly cardId: EntityId }
  // CR 704.5p — equipment on non-creature unattaches
  | { readonly kind: "equipmentUnattach"; readonly cardId: EntityId }
  // CR 704.5q — fortification on non-land unattaches
  | { readonly kind: "fortificationUnattach"; readonly cardId: EntityId }
  // CR 704.5r — +1/+1 and -1/-1 counters pairwise cancel
  | {
      readonly kind: "countersPairwiseCancel";
      readonly cardId: EntityId;
      readonly plusCount: number;
      readonly minusCount: number;
    }
  // CR 704.5v — Saga with final-chapter resolved is sacrificed
  | { readonly kind: "sagaSacrificed"; readonly cardId: EntityId }
  // CR 704.5 Class — Class permanent without a level counter gains level 1
  | { readonly kind: "classGainLevel"; readonly cardId: EntityId }
  // CR 702.103 — bestowed aura in non-battlefield reverts to creature form
  | { readonly kind: "bestowAuraReverts"; readonly cardId: EntityId }
  // CR 702.103 — bestowed aura on the battlefield whose target is gone:
  // it stops being an Aura and becomes a creature again on the battlefield
  // (NOT moved to the graveyard). Clears `bestowed` + `attachedTo`.
  | { readonly kind: "bestowAuraDetach"; readonly cardId: EntityId }
  // CR 903.9 — commander in graveyard/exile goes to command zone if owner elects
  | { readonly kind: "commanderToCommandZone"; readonly cardId: EntityId };
