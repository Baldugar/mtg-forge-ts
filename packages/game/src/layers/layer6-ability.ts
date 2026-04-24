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
// SP2 Milestone K Task 43 — `targetCardId` scopes an effect to a single
// card. An undefined `targetCardId` means "apply to every card" (the SP2
// default, matching how continuous-category statics act on every matching
// permanent today). A concrete EntityId means "only apply when computing
// THIS card's characteristics" — the shape used by per-attachment
// ability grants (Auras attaching Flying to the enchanted creature,
// Equipment granting keywords to the equipped creature). Without this
// scoping a shared Layer 6 effect array would grant the ability to
// every card in the game.
//
// Forge reference: StaticAbilityContinuous (addAbility / removeAbility /
// loseAllAbilities branches).
import type { ActiveAbilityRef, Characteristics, EntityId } from "@mtg-forge-ts/core";
import { type DepNode, resolveDependencyOrder } from "./dependency-resolver.js";

export type AbilityChangeEffect =
  | {
      readonly kind: "add";
      readonly abilityId: EntityId;
      readonly grantedBy: EntityId;
      readonly origin: ActiveAbilityRef["origin"];
      readonly timestamp: number;
      readonly targetCardId?: EntityId;
      readonly dependsOn?: readonly string[];
    }
  | {
      readonly kind: "removeAll";
      readonly grantedBy: EntityId;
      readonly timestamp: number;
      readonly targetCardId?: EntityId;
      readonly dependsOn?: readonly string[];
    }
  | {
      readonly kind: "loseAll";
      readonly timestamp: number;
      readonly targetCardId?: EntityId;
      readonly dependsOn?: readonly string[];
    };

/**
 * Apply Layer 6 ability changes to `target`.
 *
 * `targetCardId` is the entity id of the card being computed. Effects
 * whose `targetCardId` is undefined apply to every card (SP2 default);
 * effects with a concrete id apply only when that id matches. The
 * second argument is optional to preserve the pre-Task-43 call site
 * in tests that compose with the applier directly without a Game.
 */
// Layer 6 has no CDA partition (CR 604.3 doesn't carve out layer 6). The
// dependency resolver runs across all scoped effects, with timestamp
// fall-through for effects without explicit dependsOn.
const layer6NodeId = (e: AbilityChangeEffect, idx: number): string => {
  switch (e.kind) {
    case "add":
      // Adds share grantedBy across the same source ability; we disambiguate
      // by appending abilityId so each granted ref is a distinct node.
      return `add:${e.grantedBy}:${e.abilityId}`;
    case "removeAll":
      return `removeAll:${e.grantedBy}:${idx}`;
    case "loseAll":
      return `loseAll:${idx}`;
    default: {
      const _: never = e;
      throw new Error(`layer6NodeId: unreachable ${JSON.stringify(_)}`);
    }
  }
};

export const applyLayer6Ability = (
  target: Characteristics,
  targetCardId: EntityId | null,
  effects: readonly AbilityChangeEffect[],
): void => {
  const scoped = effects.filter((e) => e.targetCardId === undefined || e.targetCardId === targetCardId);
  const nodes: DepNode<AbilityChangeEffect>[] = scoped.map((e, i) => ({
    id: layer6NodeId(e, i),
    timestamp: e.timestamp,
    dependsOn: e.dependsOn ?? [],
    raw: e,
  }));
  const ordered: AbilityChangeEffect[] = resolveDependencyOrder(nodes).map(
    (n) => n.raw as AbilityChangeEffect,
  );
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
