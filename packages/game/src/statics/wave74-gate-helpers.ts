// SPDX-License-Identifier: GPL-3.0-or-later
// Wave 74 — query helpers for the three Wave-74 static modes:
//   - CantCrew                 → canCrew
//   - CantDiscard              → canDiscard
//   - ColorlessDamageSource    → damageColorOverride
//
// Each helper walks the staticEffectRegistry by mode and returns a
// single value the consumer site uses to override the canonical
// behavior at the matching decision point.
//
// Read-side consumers:
//   - canCrew                → ability/effects/crew.ts (eligible-creature
//                                 enumeration; matched creatures dropped
//                                 from the legal-crewers pool).
//   - canDiscard             → action/game-action.ts moveTo (cause
//                                 "discard" / "handSize" short-circuit).
//                              + cost/parts/cost-discard.ts (cost-pay
//                                 path likewise consults the gate so the
//                                 cost is unpayable for the matched seat;
//                                 SP4-scope follow-up — MVP gates the
//                                 effect path).
//   - damageColorOverride    → action/game-action.ts damage (future:
//                                 stamp the DamageDealt event payload's
//                                 color slot once that schema lands.
//                                 TODO(advanced) — see static handler).
//
// Why standalone helpers (not methods on Game / Game.flags): mirrors
// Wave 60.A / 60.H / 70.D / 70.E / 70.F / 70.I / 70.J / 70.K / 70.M /
// 70.O. The static registry already snapshots and restores cleanly,
// so walking the registry per-query is the right source of truth.
import type { EntityId, PlayerSeat } from "@mtg-forge-ts/core";
import type { Game } from "../game.js";
import type { CantCrewPayload } from "../static/handlers/cant-crew-static.js";
import type { CantDiscardPayload } from "../static/handlers/cant-discard-static.js";
import type { ColorlessDamageSourcePayload } from "../static/handlers/colorless-damage-source-static.js";

/**
 * True iff the creature `cardId` may tap to crew a Vehicle (CR 702.122).
 * False iff any active CantCrew static matches the candidate creature.
 *
 * Consumed by CrewEffect.resolve in the eligible-creature enumeration
 * loop: matched creatures are dropped from the legal-crewers pool. The
 * Vehicle's controller cannot pick them; if the eligible set becomes
 * empty (and the chosen subset is empty), the activation fizzles
 * silently — matches Forge's "if you can't pick enough, the ability
 * does nothing" semantics.
 *
 * Forge equivalent: `StaticAbilityCantAttachOrEnchant`-adjacent —
 * Forge piggy-backs CantCrew alongside CantAttack / CantBlock on the
 * same Aura family (Revoke Privileges et al.); we keep the gate as a
 * dedicated mode for clean snapshot/restore + zero coupling with the
 * combat-side gates.
 */
export const canCrew = (game: Game, cardId: EntityId): boolean => {
  const statics = game.staticEffectRegistry.byMode("CantCrew");
  for (const s of statics) {
    const payload = s.describe() as CantCrewPayload;
    if (!payload || payload.kind !== "replacementGen") continue;
    if (payload.cardMatches(cardId, game)) return false;
  }
  return true;
};

/**
 * True iff `seat` may discard a card (CR 701.8). False iff any active
 * CantDiscard static matches the seat.
 *
 * Consumed by GameAction.moveTo BEFORE the MoveToIntent is constructed
 * when the cause is "discard" or "handSize"; on a match the action
 * no-ops silently (no zone change, no CardDiscarded event, no
 * DiscardedTrigger fire). The cost-pay path that consumes a hand card
 * (CostDiscard) likewise consults this gate so the cost is unpayable
 * for the matched seat (SP4-scope MVP — the effect path is the
 * dominant call site).
 *
 * Forge equivalent: `StaticAbilityCantDiscard.applyAbility(...)`
 * returning a non-null gating static.
 */
export const canDiscard = (game: Game, seat: PlayerSeat): boolean => {
  const statics = game.staticEffectRegistry.byMode("CantDiscard");
  for (const s of statics) {
    const payload = s.describe() as CantDiscardPayload;
    if (!payload || payload.kind !== "replacementGen") continue;
    if (payload.playerMatches(seat)) return false;
  }
  return true;
};

/**
 * Returns "colorless" iff the source `sourceId` is matched by any
 * active ColorlessDamageSource static (CR 105). Returns null when
 * no matching gate is in force — the canonical layer-engine color
 * computation prevails.
 *
 * Read-side wiring is TODO(advanced) until the DamageDealt event
 * payload gains a damage-color slot; the static still registers and
 * the helper is exposed so the future damage pipeline can read it
 * uniformly.
 */
export const damageColorOverride = (game: Game, sourceId: EntityId): "colorless" | null => {
  const statics = game.staticEffectRegistry.byMode("ColorlessDamageSource");
  for (const s of statics) {
    const payload = s.describe() as ColorlessDamageSourcePayload;
    if (!payload || payload.kind !== "colorlessDamageSource") continue;
    if (payload.cardMatches(sourceId, game)) return "colorless";
  }
  return null;
};
