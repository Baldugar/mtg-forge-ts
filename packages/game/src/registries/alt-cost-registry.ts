// SPDX-License-Identifier: GPL-3.0-or-later
// AltCostRegistry — registry of alternative casting cost evaluators.
//
// An AltCost represents a way to cast a spell other than its normal mana cost
// (Flashback, Madness, Escape, Overload, etc.). The registry is consulted by
// the cast pipeline in stepChooseAltCosts (CR 601.2b) to discover which
// alternative costs are available for the card being cast.
//
// Design:
//   - AltCost objects are registered at startup (side-effect imports from
//     game/src/altcost/index.ts).
//   - The cast pipeline calls altCostRegistry.available(card, game) to find
//     which alternatives apply, then offers them to the player via the
//     castProposal.altCostKey field.
//   - The selected AltCost's modifyCastContext mutates the CastContext:
//     replaces the cost, marks altCostUsed, and (if needed) sets
//     alternativeZoneDestination (e.g. Flashback → Exile).
//
// Wave 5: Flashback is the first registered AltCost.
import type { ZoneType } from "@mtg-forge-ts/core";
import type { SpellAbility } from "../ability/spell-ability.js";
import type { Card } from "../card.js";
import type { CastContext } from "../cast/cast-context.js";
import type { Game } from "../game.js";

export interface AltCost {
  /** Unique key matching Forge's alt-cost DSL name (e.g. "Flashback"). */
  readonly handlerKey: string;

  /**
   * Is this alternative cost available for casting `card` right now?
   * Called for every registered AltCost; returning false means the option
   * is not offered to the player.
   */
  isAvailable(card: Card, game: Game): boolean;

  /**
   * Apply the alternative cost to the cast context. Called after the player
   * selects this alt-cost in stepChooseAltCosts. Mutates ctx in-place:
   *   - ctx.altCostUsed should be set to handlerKey.
   *   - ctx.totalCost (or its base) should be replaced with the alt cost.
   *   - ctx.alternativeZoneDestination may be set (e.g. Exile for Flashback).
   */
  modifyCastContext(ctx: CastContext, sa: SpellAbility, game: Game): void;
}

class AltCostRegistry {
  private readonly byKey = new Map<string, AltCost>();

  register(c: AltCost): void {
    this.byKey.set(c.handlerKey, c);
  }

  lookup(key: string): AltCost | undefined {
    return this.byKey.get(key);
  }

  has(key: string): boolean {
    return this.byKey.has(key);
  }

  /**
   * Return all alternative costs available for `card` in the current game
   * state. Returns an empty array when no alternatives are available (e.g.
   * Flashback requires the card to be in the graveyard).
   */
  available(card: Card, game: Game): readonly AltCost[] {
    const out: AltCost[] = [];
    for (const c of this.byKey.values()) {
      if (c.isAvailable(card, game)) out.push(c);
    }
    return out;
  }

  /** Test helper — clear all registrations. */
  clear(): void {
    this.byKey.clear();
  }

  listKeys(): string[] {
    return [...this.byKey.keys()];
  }
}

export const altCostRegistry = new AltCostRegistry();

// Re-export the type for CastContext usage in cast-pipeline.ts
export type { ZoneType };
