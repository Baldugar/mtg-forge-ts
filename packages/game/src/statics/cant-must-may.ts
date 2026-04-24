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
  | "cantUntap";

export interface Restriction {
  readonly sourceStaticId: EntityId;
  readonly kind: RestrictionKind;
  readonly subjectFilter: (subjectId: EntityId | PlayerSeat, game: Game) => boolean;
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
