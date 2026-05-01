// SPDX-License-Identifier: GPL-3.0-or-later
// Wave 70.M — query helpers for the four Wave-70.M static modes:
//   - PlayerMustAttack    → playerMustAttackRequirements
//   - CantBeCopied        → cantBeCopied
//   - MaxCounter          → maxCounter
//   - CantLoseLife        → canLoseLife
//
// Each helper walks the staticEffectRegistry by mode and returns a
// single value (boolean / numeric cap / requirement set) the consumer
// site uses to override the canonical behavior at the matching
// decision point.
//
// Read-side consumers:
//   - playerMustAttackRequirements → combat-handler declareAttackers —
//                                     when the active player matches a
//                                     requirement, declareAttackers
//                                     must include at least one
//                                     creature attacking a defender
//                                     that satisfies the requirement.
//   - cantBeCopied                 → Stack.copy / token-copy site —
//                                     when the source matches an
//                                     active gate, the copy attempt
//                                     is rejected silently.
//   - maxCounter                   → GameAction.addCounter — clamps
//                                     the requested amount so the
//                                     post-add count does not exceed
//                                     the lowest active cap.
//   - canLoseLife                  → GameAction.changeLife (negative
//                                     delta) — when matched, the delta
//                                     is rewritten to 0 BEFORE the
//                                     LifeChanged event is emitted.
//
// Why standalone helpers (not methods on Game / Game.flags): mirrors
// Wave 60.A / 60.H / 70.D-L. The static registry already snapshots and
// restores cleanly, so walking the registry per-query is the right
// source of truth.
import type { CounterType, EntityId, PlayerSeat } from "@mtg-forge-ts/core";
import type { Game } from "../game.js";
import type { CantBeCopiedPayload } from "../static/handlers/cant-be-copied-static.js";
import type { CantLoseLifePayload } from "../static/handlers/cant-lose-life-static.js";
import type { MaxCounterPayload } from "../static/handlers/max-counter-static.js";
import type {
  PlayerMustAttackDefender,
  PlayerMustAttackPayload,
} from "../static/handlers/player-must-attack-static.js";

/**
 * The set of active PlayerMustAttack requirements for a given attacking
 * player. Each entry is the gate's payload; the combat-handler at
 * declareAttackers consults `defenderMatches` to decide which candidate
 * defenders satisfy the requirement.
 *
 * Returns an empty array when no PlayerMustAttack gate matches the
 * seat; in that case there is no must-attack requirement (canonical
 * default).
 */
export const playerMustAttackRequirements = (
  game: Game,
  attackingSeat: PlayerSeat,
): readonly PlayerMustAttackPayload[] => {
  const statics = game.staticEffectRegistry.byMode("PlayerMustAttack");
  if (statics.length === 0) return [];
  const out: PlayerMustAttackPayload[] = [];
  for (const s of statics) {
    const payload = s.describe() as PlayerMustAttackPayload;
    if (!payload || payload.kind !== "playerMustAttack") continue;
    if (!payload.playerMatches(attackingSeat)) continue;
    out.push(payload);
  }
  return out;
};

/**
 * Convenience helper: true iff the attacking player has at least one
 * active PlayerMustAttack requirement and the candidate defender (a
 * Player or a Planeswalker) would satisfy at least one of them.
 *
 * The combat-handler uses this when filtering legal attack targets:
 * a defender that satisfies any active requirement is preferred for
 * auto-correct flows. See `playerMustAttackRequirements` for the
 * full set of payloads when finer-grained handling is needed.
 */
export const playerMustAttackDefenderSatisfies = (
  game: Game,
  attackingSeat: PlayerSeat,
  defender: PlayerMustAttackDefender,
): boolean => {
  const reqs = playerMustAttackRequirements(game, attackingSeat);
  for (const r of reqs) {
    if (r.defenderMatches(defender)) return true;
  }
  return false;
};

/**
 * True iff any active CantBeCopied static rejects copying the source
 * stack item / permanent. False (canonical default) iff no matching
 * gate is in force.
 *
 * Forge equivalent: `StaticAbilityCantBeCopied.cantBeCopied(card)`.
 */
export const cantBeCopied = (game: Game, sourceCardId: EntityId): boolean => {
  const statics = game.staticEffectRegistry.byMode("CantBeCopied");
  for (const s of statics) {
    const payload = s.describe() as CantBeCopiedPayload;
    if (!payload || payload.kind !== "replacementGen") continue;
    if (payload.cardMatches(sourceCardId, game)) return true;
  }
  return false;
};

/**
 * Returns the lowest active MaxCounter cap on `cardId` for
 * `counterType`, or `undefined` when no gate matches. The addCounter
 * call site uses this to clamp the requested amount: when the
 * post-add count would exceed the cap, the requested amount is
 * reduced (or zeroed entirely) so the post-add count equals the cap.
 *
 * Forge equivalent: `StaticAbilityMaxCounter.maxCounter(card, type)`.
 */
export const maxCounter = (game: Game, cardId: EntityId, counterType: CounterType): number | undefined => {
  const statics = game.staticEffectRegistry.byMode("MaxCounter");
  if (statics.length === 0) return undefined;
  let lowest: number | undefined;
  for (const s of statics) {
    const payload = s.describe() as MaxCounterPayload;
    if (!payload || payload.kind !== "replacementGen") continue;
    if (!payload.cardMatches(cardId, game)) continue;
    if (!payload.counterMatches(counterType)) continue;
    if (lowest === undefined || payload.maxNum < lowest) lowest = payload.maxNum;
  }
  return lowest;
};

/**
 * True iff `seat` may lose life (CR 119). False iff any active
 * CantLoseLife static matches the seat. Consumed by
 * GameAction.changeLife when the delta is negative (life-loss) — on
 * a match the delta is rewritten to 0 BEFORE the LifeChanged event is
 * emitted, so downstream observers (Bloodgift Demon / Punishing Fire
 * / Vampire Nighthawk damage-trigger feedbacks) do not observe a loss.
 *
 * Damage-induced life loss (CR 119.3) routes through changeLife and
 * is therefore covered by the same gate. The "Each player's life
 * total becomes 1, then until end of turn, players can't lose life"
 * shape (Everybody Lives!) consults this helper.
 */
export const canLoseLife = (game: Game, seat: PlayerSeat, sourceId?: EntityId): boolean => {
  const statics = game.staticEffectRegistry.byMode("CantLoseLife");
  for (const s of statics) {
    const payload = s.describe() as CantLoseLifePayload;
    if (!payload || payload.kind !== "replacementGen") continue;
    if (!payload.playerMatches(seat)) continue;
    // Wave 97 — CantLoseLifeFromSource$ source-conditional gate. When the
    // static omits FromSource$, sourceMatches trivially returns true and
    // the gate fires for every loss. When present, only matching sources
    // gate the loss; non-matching sources fall through.
    if (!payload.sourceMatches(sourceId, game)) continue;
    return false;
  }
  return true;
};
