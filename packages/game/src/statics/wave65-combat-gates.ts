// SPDX-License-Identifier: GPL-3.0-or-later
// Wave 65 — combat-side query helpers + flag-reading utilities used by the
// CombatHandler at attacker / blocker declaration. Same registry-walk
// pattern as Wave 50 (cant-must-may-extras.ts) and Wave 60.A
// (wave60-cant-gates.ts) — read-only, side-effect-free, snapshot-friendly.
//
// Wave 65.B — adds an EndStep sweep for warpedUntilEot (CR 702.180a,
// Edge of Eternities). The Warp altcost stamps the flag during the
// cast; the sweep exiles flagged cards at the next end step and
// clears the flag. Distinct from sweepEndOfCombat — that sweep fires
// at end of combat (decayed sacrifice timing), this fires at end of
// turn (CR 514).
//
// Closes the "registered but not consulted at decision points" gap that the
// Wave-59 audit identified for several cant/must combat statics + stamped
// card flags:
//
//   - canAttack      → consults the cantAttack restriction registry; an
//                      attacker that matches any active CantAttack is
//                      illegal at declaration.
//   - mustAttack     → consults the mustAttack restriction registry; the
//                      caller (attacker-declaration validator) auto-adds
//                      matched creatures to the attackers list.
//   - canBlock       → consults card.decayed (CR 702.176) — decayed
//                      creatures are excluded from the legal-blocker pool.
import type { EntityId } from "@mtg-forge-ts/core";
import { ZoneType } from "@mtg-forge-ts/core";
import type { EngineYield } from "../action/engine-yield.js";
import type { Game } from "../game.js";
import { gatherRestrictions } from "./cant-must-may.js";

/**
 * True iff `attackerId` may legally be declared as an attacker. False iff
 * any active CantAttack restriction matches the creature.
 *
 * Wave 50 registered the CantAttack static handler; Wave 65.A wires the
 * read at declareAttackers so a Propaganda-shape "creatures can't attack"
 * static actually rejects the declaration.
 */
export const canAttack = (game: Game, attackerId: EntityId): boolean => {
  for (const r of gatherRestrictions(game, "cantAttack")) {
    if (r.subjectFilter(attackerId, game)) return false;
  }
  return true;
};

/**
 * Returns the creature ids on the active player's battlefield that are
 * subject to an active MustAttack restriction. Each entry must be in the
 * attackers list when DeclareAttackers closes (the goad-shape "must
 * attack each combat if able"). Wave 65.A MVP auto-adds them; full
 * "if able" gating (tap state, summoning sickness, CantAttack statics
 * that win out) is handled by the caller.
 *
 * The returned ids are SUBJECTS — the static's ValidCard$ matched them.
 * The caller still needs to pick a defender (the helper does NOT carry
 * MustAttack$ <player> sub-param payload yet — that's // TODO(advanced)).
 */
export const collectMustAttackSubjects = (game: Game): readonly EntityId[] => {
  const out: EntityId[] = [];
  const seen = new Set<EntityId>();
  for (const r of gatherRestrictions(game, "mustAttack")) {
    for (const card of game.cards.values()) {
      const id = card.id;
      if (seen.has(id)) continue;
      if (r.subjectFilter(id, game)) {
        out.push(id);
        seen.add(id);
      }
    }
  }
  return out;
};

/**
 * True iff `blockerId` may legally be declared as a blocker. False iff
 * the creature carries the `decayed` flag (CR 702.176 — "A creature with
 * decayed can't block.").
 *
 * Forward-compatible with future "can't block" sources (e.g. tap state +
 * defender keyword negation, prowl-shape "can't block this turn"
 * stamps); MVP only consults the decayed flag here. The static-driven
 * cantBlock kind is handled in block-restrictions.ts via
 * isBlockingRestricted.
 */
export const canBlock = (game: Game, blockerId: EntityId): boolean => {
  const card = game.cards.get(blockerId);
  if (!card) return true;
  if (card.decayed === true) return false;
  return true;
};

/**
 * Wave 65.A — End-of-Combat sweep. Sacrifices every decayed creature that
 * attacked this combat (CR 702.176 second sentence — "When this creature
 * attacks, sacrifice it at end of combat"); then clears
 * attackedThisCombat on every card so the next combat opens fresh.
 *
 * Implemented as a free function so phase-handler can drive it without
 * requiring a CombatHandler instance to be attached to Game (the
 * existing test fixtures construct CombatHandler externally — adding a
 * Game.combat slot would break their construction shape). The
 * mirror method on CombatHandler (`combatHandler.endOfCombat`) wraps
 * this free function.
 */
export function* sweepEndOfCombat(game: Game): Generator<EngineYield, void, unknown> {
  // Snapshot ids first — game.action.sacrifice mutates the card map
  // (moveTo to graveyard), and iterating the live map mid-sacrifice
  // can skip entries.
  const decayedAttackers: EntityId[] = [];
  for (const card of game.cards.values()) {
    if (card.decayed === true && card.attackedThisCombat === true) {
      decayedAttackers.push(card.id);
    }
  }
  for (const id of decayedAttackers) {
    yield* game.action.sacrifice(id);
  }
  // Clear the attacked-this-combat flag on every card; the next combat
  // re-stamps when declareAttackers runs.
  for (const card of game.cards.values()) {
    if (card.attackedThisCombat) card.attackedThisCombat = false;
  }
}

/**
 * Wave 65.B — End-of-Turn sweep. Exiles every card flagged with
 * `warpedUntilEot` (CR 702.180a — "exile it at the beginning of the
 * next end step") and clears the flag in the same pass so the stamp is
 * one-shot. The Warp altcost (`altcost/warp.ts`) stamps the flag at
 * cast time; this sweep is the read.
 *
 * Implemented as a free function to mirror sweepEndOfCombat — the
 * PhaseHandler drives it without needing a dedicated handler instance
 * attached to Game. Snapshots the id list before mutating the card map
 * (moveTo to Exile bumps zone state and replacement-effect lookups
 * iterate the live map).
 */
export function* sweepEndOfTurnWarpExile(game: Game): Generator<EngineYield, void, unknown> {
  const warped: EntityId[] = [];
  for (const card of game.cards.values()) {
    if (card.warpedUntilEot === true) {
      warped.push(card.id);
    }
  }
  for (const id of warped) {
    yield* game.action.moveTo(id, ZoneType.Exile);
  }
  // Clear the flag on every flagged card AFTER the moveTo passes; if the
  // moveTo was prevented (replacement effects) we still clear so the
  // delayed trigger doesn't accumulate. CR 702.180a treats the exile as
  // a single one-shot end-step delayed trigger; it doesn't re-arm.
  for (const card of game.cards.values()) {
    if (card.warpedUntilEot === true) card.warpedUntilEot = undefined;
  }
}
