// SPDX-License-Identifier: GPL-3.0-or-later
// can't/must/may restrictions — "attack each turn if able", "can't be
// countered", "creatures can't attack you". The decision validator
// (Task 41's legal-action enumerator + priority orchestrator) consults
// gatherRestrictions to filter legal choices.
//
// SP2 pins the interface; SP3 + Milestone M (combat) wire it to the
// combat declaration flow and to the priority decision legal-action
// enumeration.
//
// The describe() return is tolerated in two shapes, matching the
// cost-mod contributor:
//   - the bare Restriction object, or
//   - a tagged envelope `{ kind: "restriction", effect: Restriction }`.
//
// Architectural note: RestrictionKind is the action-filter subset
// consulted by the decision validator. Forge's full Cant* taxonomy
// lives in StaticAbilityMode (packages/core); mutation-interception
// kinds (CantDraw, CantSacrifice, CantBeCopied, etc.) are
// replacement-generating statics, NOT action filters.
import type { EntityId, PlayerSeat } from "@mtg-forge-ts/core";
import type { Game } from "../game.js";

export type RestrictionKind =
  | "cantCast"
  | "cantActivate"
  | "cantAttack"
  | "mustAttack"
  | "cantBlock"
  | "mustBlock"
  | "cantTarget"
  | "cantUntap"
  | "mustTarget"
  | "cantPhaseIn"
  | "cantPhaseOut"
  // Wave 50 — Forge cant/must/may family expansion. Subject conventions:
  //   cantBlockBy:  subject = ATTACKER id (filters on the attacker; the
  //                 paired blocker id is supplied via auxFilter / second arg).
  //   canAttackDefender / castWithFlash: positive overrides — subject is the
  //                 candidate id (creature or spell card). isAllowed walks
  //                 statics of the matching kind and returns true on first hit.
  //   minMaxBlocker: subject = ATTACKER id; resolution carries the {min,max}
  //                 block-count tuple via the static's describe() payload
  //                 itself (not a generic boolean filter).
  | "cantBlockBy"
  | "canAttackDefender"
  | "castWithFlash"
  | "minMaxBlocker"
  // OptionalCost is canonical-mapped to cantMustMay (see static-ability-mode
  // category map). Modeled as a restriction so it flows through the same
  // gatherRestrictions sweep; its payload field carries the cost string.
  | "optionalCost";

export interface Restriction {
  readonly sourceStaticId: EntityId;
  readonly kind: RestrictionKind;
  readonly subjectFilter: (subjectId: EntityId | PlayerSeat, game: Game) => boolean;
  /**
   * Optional second filter for two-subject restrictions (cantBlockBy:
   * filters the blocker; minMaxBlocker: unused; the others ignore it).
   * Wave 50 — keeps the Restriction shape backwards-compatible while
   * letting cantBlockBy carry attacker→blocker pairing without a custom
   * carrier type.
   */
  readonly auxFilter?: (auxId: EntityId | PlayerSeat, game: Game) => boolean;
  /**
   * Optional payload — minMaxBlocker stamps {min,max} here. `unknown` to
   * keep the Restriction interface universal; consumers cast.
   */
  readonly payload?: unknown;
}

interface RestrictionEnvelope {
  readonly kind: "restriction";
  readonly effect: Restriction;
}

const isEnvelope = (x: unknown): x is RestrictionEnvelope =>
  typeof x === "object" && x !== null && "kind" in x && (x as { kind: unknown }).kind === "restriction";

export const gatherRestrictions = (game: Game, kind: RestrictionKind): readonly Restriction[] => {
  const statics = game.staticEffectRegistry.byCategory("cantMustMay");
  const out: Restriction[] = [];
  for (const s of statics) {
    const payload = s.describe();
    const concrete: Restriction = isEnvelope(payload) ? payload.effect : (payload as Restriction);
    if (concrete.kind === kind) out.push(concrete);
  }
  return out;
};

export const isRestricted = (
  game: Game,
  kind: RestrictionKind,
  subjectId: EntityId | PlayerSeat,
): boolean => {
  for (const r of gatherRestrictions(game, kind)) {
    if (r.subjectFilter(subjectId, game)) return true;
  }
  return false;
};
