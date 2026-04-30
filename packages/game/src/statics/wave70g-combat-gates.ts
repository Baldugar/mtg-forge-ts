// SPDX-License-Identifier: GPL-3.0-or-later
// Wave 70.G — query helpers for the three Wave-70.G static modes:
//   - CanAttackIfHaste   → canAttackAsIfHaste
//   - MustBlock          → collectMustBlockSubjects (mirror of
//                           collectMustAttackSubjects in Wave 65)
//   - AttackVigilance    → attacksWithVigilance
//
// Each helper walks the staticEffectRegistry by mode (or by the
// existing cantMustMay restriction sweep, for MustBlock) and returns
// the matched answer the consumer site uses to override the canonical
// rules behavior at the matching decision point.
//
// Read-side consumers:
//   - canAttackAsIfHaste     → SP3 attacker validator (would-be summoning-
//                              sickness rejection is suppressed when a
//                              CanAttackIfHaste static covers this attacker
//                              + declared defender pair). Today the engine
//                              does not enforce summoning sickness on
//                              attack — the helper is exposed so the
//                              future enforcement site reads from the
//                              same source of truth.
//   - collectMustBlockSubjects → SP3 blocker-declaration auto-correct
//                              (mirror of CombatHandler.applyMustAttack):
//                              creatures matching the registry must be
//                              declared as blockers if able. Today the
//                              engine surfaces the restriction via
//                              gatherRestrictions("mustBlock"); this
//                              helper enumerates the subject ids on the
//                              battlefield for a one-pass auto-correct.
//   - attacksWithVigilance    → CombatHandler.declareAttackers tap pass
//                              (Wave 7 keyword vigilance is the canonical
//                              source; this helper extends the check to
//                              static-granted vigilance — Archangel of
//                              Tithes, Heat Wave, Awesome Presence
//                              analogues).
//
// Why standalone helpers (not methods on Game / Game.flags): mirrors
// Wave 60.A / 60.H / 70.D / 70.E / 70.F. The static registry already
// snapshots and restores cleanly, so walking the registry per-query is
// the right source of truth.
import type { EntityId, PlayerSeat } from "@mtg-forge-ts/core";
import type { Game } from "../game.js";
import type { AttackVigilancePayload } from "../static/handlers/attack-vigilance-static.js";
import type { CanAttackIfHastePayload } from "../static/handlers/can-attack-if-haste-static.js";
import type { MustBlockPayload } from "../static/handlers/must-block-static.js";
import { gatherRestrictions } from "./cant-must-may.js";

/**
 * Defender-target shape mirroring the AttackerInfo.defender union from
 * combat-state. Kept local to avoid a circular dependency.
 */
export type DefenderForGate =
  | { readonly kind: "player"; readonly seat: PlayerSeat }
  | { readonly kind: "planeswalker"; readonly id: EntityId }
  | { readonly kind: "battle"; readonly id: EntityId };

/**
 * True iff `attackerId` may attack the declared defender as though it
 * had haste — i.e. an active CanAttackIfHaste static matches the
 * (attacker, defender) pair.
 *
 * Forge cards using this (Glorybringer / Frenzied Saddlebrute / Instill
 * Energy / Combat Celebrant family). Today the engine does not enforce
 * summoning sickness at attack time, so callers should treat a `true`
 * return as "the haste rejection MUST be suppressed for this attack" —
 * the sickness check is the future SP3 enforcement site.
 *
 * Defender-side filter is permissive: when ValidTarget$ is omitted (the
 * Instill Energy shape), every defender matches. When present, EITHER
 * the seat predicate OR the card predicate must match (the corpus mixes
 * "Opponent" + "Planeswalker.OppCtrl" shapes).
 */
export const canAttackAsIfHaste = (game: Game, attackerId: EntityId, defender: DefenderForGate): boolean => {
  const statics = game.staticEffectRegistry.byMode("CanAttackIfHaste");
  for (const s of statics) {
    const payload = s.describe() as CanAttackIfHastePayload;
    if (!payload.cardMatches(attackerId, game)) continue;
    if (defender.kind === "player") {
      if (!payload.defenderSeatMatches(defender.seat)) continue;
    } else {
      if (!payload.defenderCardMatches(defender.id, game)) continue;
    }
    return true;
  }
  return false;
};

/**
 * Returns the creature ids that must block this combat (CR 509.1g). The
 * mirror of `collectMustAttackSubjects` (Wave 65). Walks every active
 * mustBlock restriction; for each, collects the battlefield creature ids
 * matching the static's blocker filter. The MustBlockPayload's
 * attackerFilterRaw / attackerMatches are surfaced as the second tuple
 * element so the caller can pair the must-blocker with its required
 * attacker (Lure-shape "must block CARDNAME").
 *
 * The returned ids are SUBJECTS — the static's ValidCreature$ matched
 * them. The caller still needs to enforce "if able" gating (tap state,
 * summoning sickness, CantBlock statics that win out, evasion blocking
 * the matched attacker) — same contract as collectMustAttackSubjects.
 */
export const collectMustBlockSubjects = (
  game: Game,
): readonly { readonly blockerId: EntityId; readonly mustBlockAttackerId?: EntityId }[] => {
  const out: { blockerId: EntityId; mustBlockAttackerId?: EntityId }[] = [];
  const seen = new Set<EntityId>();
  for (const r of gatherRestrictions(game, "mustBlock")) {
    const payload = r.payload as MustBlockPayload | undefined;
    for (const card of game.cards.values()) {
      const id = card.id;
      if (seen.has(id)) continue;
      if (!r.subjectFilter(id, game)) continue;
      // Find the required attacker (if any) by scanning for the first
      // battlefield creature matching attackerMatches. MVP — the SP3
      // auto-correct picks the first match; full Forge fidelity would
      // gather all candidates and let the must-blocker choose.
      let mustBlockAttackerId: EntityId | undefined;
      if (payload?.attackerFilterRaw !== undefined && payload.attackerFilterRaw.length > 0) {
        for (const cand of game.cards.values()) {
          if (payload.attackerMatches(cand.id, game)) {
            mustBlockAttackerId = cand.id;
            break;
          }
        }
      }
      out.push(
        mustBlockAttackerId === undefined ? { blockerId: id } : { blockerId: id, mustBlockAttackerId },
      );
      seen.add(id);
    }
  }
  return out;
};

/**
 * True iff `attackerId` attacks without tapping (vigilance-equivalent)
 * because some active AttackVigilance static matches it. Combat-handler's
 * declareAttackers tap pass calls this BEFORE setting `tapped = true` on
 * the declared attacker; on a match the tap is suppressed.
 *
 * Distinct from the keyword `vigilance` — that lives on Characteristics
 * and is the canonical "this card has vigilance" source. The static-
 * driven gate covers cards that grant the property via static rather
 * than via keyword text (Archangel of Tithes / Heat Wave / Awesome
 * Presence shapes).
 */
export const attacksWithVigilance = (game: Game, attackerId: EntityId): boolean => {
  const statics = game.staticEffectRegistry.byMode("AttackVigilance");
  for (const s of statics) {
    const payload = s.describe() as AttackVigilancePayload;
    if (payload.cardMatches(attackerId, game)) return true;
  }
  return false;
};
