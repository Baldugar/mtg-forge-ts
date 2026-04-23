// SPDX-License-Identifier: GPL-3.0-or-later
// CR 613.1f — Layer 6 ability-adding and ability-removing effects.
// Timestamp-ordered; no CDA partition (CR 604.3 doesn't carve out layer 6).
//
// Kinds:
//   - "add":       append an ActiveAbilityRef to target.abilities.
//   - "removeAll": filter out any ref granted by a specified ability.
//   - "loseAll":   clear target.abilities entirely (strips intrinsic too).
//
// Note: "loseAll" at an earlier timestamp followed by "add" at a later
// timestamp leaves only the added refs — matching Forge's loseAllAbilities
// precedence in StaticAbilityContinuous.
//
// Forge reference: StaticAbilityContinuous (addAbility / removeAbility /
// loseAllAbilities branches).
import type { ActiveAbilityRef, Characteristics, EntityId } from "@mtg-forge-ts/core";

export type AbilityChangeEffect =
  | {
      readonly kind: "add";
      readonly abilityId: EntityId;
      readonly grantedBy: EntityId;
      readonly origin: ActiveAbilityRef["origin"];
      readonly timestamp: number;
    }
  | {
      readonly kind: "removeAll";
      readonly grantedBy: EntityId;
      readonly timestamp: number;
    }
  | {
      readonly kind: "loseAll";
      readonly timestamp: number;
    };

export const applyLayer6Ability = (
  target: Characteristics,
  effects: readonly AbilityChangeEffect[],
): void => {
  const ordered = [...effects].sort((a, b) => a.timestamp - b.timestamp);
  for (const e of ordered) {
    switch (e.kind) {
      case "add":
        target.abilities.push({ id: e.abilityId, grantedBy: e.grantedBy, origin: e.origin });
        break;
      case "removeAll":
        target.abilities = target.abilities.filter((a) => a.grantedBy !== e.grantedBy);
        break;
      case "loseAll":
        target.abilities = [];
        break;
      default: {
        const _: never = e;
        throw new Error(`applyLayer6Ability: unreachable ${JSON.stringify(_)}`);
      }
    }
  }
};
