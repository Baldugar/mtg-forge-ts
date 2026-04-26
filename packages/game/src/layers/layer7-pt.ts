// SPDX-License-Identifier: GPL-3.0-or-later
// CR 613.1g — Layer 7 power/toughness sublayers.
//   7a: characteristic-defining P/T (e.g. "*/* equal to X").
//   7b: set P/T ("becomes 3/3").
//   7c: modify P/T ("+2/+0 until end of turn").
//   7d: counters (+1/+1, -1/-1, and P/T-adjusting counters).
//   7e: switch P/T.
// Within each sublayer, effects resolve in dependency-then-timestamp order
// (CR 613.8) via resolveDependencyOrder. SP2 effects without explicit
// dependsOn degenerate to stable timestamp ordering.
//
// CR 613.4b — a P/T-modifying effect has no effect on a permanent that is
// not a creature. Sublayers 7c/7d/7e short-circuit when the current
// characteristics have null power/toughness (non-creature); sublayers 7a
// (CDA set) and 7b (becomes) are how a non-creature gets a P/T in the
// first place, so they do NOT gate on null. For 7e (switch), a one-side-
// null case would mint an asymmetric result — skip entirely.
//
// Forge reference: StaticAbilityContinuous (setPT / addPT); Card#getNetPower
// and Card#getNetToughness consolidate counter-driven +N/+N.
import type { Characteristics, EntityId } from "@mtg-forge-ts/core";
import { type DepNode, resolveDependencyOrder } from "./dependency-resolver.js";

export interface Layer7aEffect {
  readonly kind: "cdaSet";
  readonly power: number;
  readonly toughness: number;
  readonly timestamp: number;
  readonly sourceAbilityId: EntityId | null;
  readonly dependsOn?: readonly string[];
}

export interface Layer7bEffect {
  readonly kind: "set";
  readonly power: number;
  readonly toughness: number;
  readonly timestamp: number;
  readonly sourceAbilityId: EntityId | null;
  readonly dependsOn?: readonly string[];
}

export interface Layer7cEffect {
  readonly kind: "modify";
  readonly powerDelta: number;
  readonly toughnessDelta: number;
  readonly timestamp: number;
  readonly sourceAbilityId: EntityId | null;
  readonly dependsOn?: readonly string[];
  /**
   * Wave 10 — Bestow's "Affected$ Card.EnchantedBy" static needs to apply
   * its P/T modifier to the enchanted creature only, not every card. When
   * `targetCardIdFn` is set, applyLayer7c calls the function to compute
   * the current target card id; the effect is applied only when the
   * function returns the id of the card being computed. When undefined,
   * the effect is global (the SP2 default — applied to every card).
   *
   * Function-shape (rather than a static EntityId) because Auras can be
   * re-attached during their lifetime — the target id changes as the
   * Aura re-attaches. Caching the static id on register would silently
   * leak the original target.
   */
  readonly targetCardIdFn?: () => EntityId | null;
}

export type Layer7dEffect =
  | {
      readonly kind: "plusOnePlusOne";
      readonly count: number;
      readonly timestamp: number;
      readonly sourceAbilityId: EntityId | null;
      readonly dependsOn?: readonly string[];
    }
  | {
      readonly kind: "minusOneMinusOne";
      readonly count: number;
      readonly timestamp: number;
      readonly sourceAbilityId: EntityId | null;
      readonly dependsOn?: readonly string[];
    }
  | {
      readonly kind: "ptCounter";
      readonly powerPer: number;
      readonly toughnessPer: number;
      readonly count: number;
      readonly timestamp: number;
      readonly sourceAbilityId: EntityId | null;
      readonly dependsOn?: readonly string[];
    };

export interface Layer7eEffect {
  readonly kind: "switch";
  readonly timestamp: number;
  readonly sourceAbilityId: EntityId | null;
  readonly dependsOn?: readonly string[];
}

const nodeId = (e: { readonly sourceAbilityId: EntityId | null }, idx: number): string =>
  e.sourceAbilityId !== null ? String(e.sourceAbilityId) : `__anon_${idx}`;

const toDepNodes = <
  T extends {
    readonly timestamp: number;
    readonly sourceAbilityId: EntityId | null;
    readonly dependsOn?: readonly string[];
  },
>(
  effects: readonly T[],
): DepNode<T>[] =>
  effects.map((e, i) => ({
    id: nodeId(e, i),
    timestamp: e.timestamp,
    dependsOn: e.dependsOn ?? [],
    raw: e,
  }));

export const applyLayer7a = (c: Characteristics, effects: readonly Layer7aEffect[]): void => {
  const ordered = resolveDependencyOrder(toDepNodes(effects)).map((n) => n.raw as Layer7aEffect);
  for (const e of ordered) {
    c.power = e.power;
    c.toughness = e.toughness;
  }
};

export const applyLayer7b = (c: Characteristics, effects: readonly Layer7bEffect[]): void => {
  const ordered = resolveDependencyOrder(toDepNodes(effects)).map((n) => n.raw as Layer7bEffect);
  for (const e of ordered) {
    c.power = e.power;
    c.toughness = e.toughness;
  }
};

export const applyLayer7c = (
  c: Characteristics,
  effects: readonly Layer7cEffect[],
  targetCardId?: EntityId | null,
): void => {
  const scoped =
    targetCardId === undefined
      ? effects
      : effects.filter((e) => {
          if (e.targetCardIdFn === undefined) return true; // global
          return e.targetCardIdFn() === targetCardId;
        });
  const ordered = resolveDependencyOrder(toDepNodes(scoped)).map((n) => n.raw as Layer7cEffect);
  for (const e of ordered) {
    // CR 613.4b — don't confer a P/T on a non-creature.
    if (c.power === null || c.toughness === null) continue;
    c.power = c.power + e.powerDelta;
    c.toughness = c.toughness + e.toughnessDelta;
  }
};

export const applyLayer7d = (c: Characteristics, effects: readonly Layer7dEffect[]): void => {
  const ordered = resolveDependencyOrder(toDepNodes(effects)).map((n) => n.raw as Layer7dEffect);
  for (const e of ordered) {
    // CR 613.4b — don't confer a P/T on a non-creature.
    if (c.power === null || c.toughness === null) continue;
    switch (e.kind) {
      case "plusOnePlusOne":
        c.power = c.power + e.count;
        c.toughness = c.toughness + e.count;
        break;
      case "minusOneMinusOne":
        c.power = c.power - e.count;
        c.toughness = c.toughness - e.count;
        break;
      case "ptCounter":
        c.power = c.power + e.powerPer * e.count;
        c.toughness = c.toughness + e.toughnessPer * e.count;
        break;
      default: {
        const _: never = e;
        throw new Error(`applyLayer7d: unreachable ${JSON.stringify(_)}`);
      }
    }
  }
};

export const applyLayer7e = (c: Characteristics, effects: readonly Layer7eEffect[]): void => {
  const ordered = resolveDependencyOrder(toDepNodes(effects)).map((n) => n.raw as Layer7eEffect);
  for (const _ of ordered) {
    // CR 613.4b — skip switch on non-creatures (would mint a half-null swap
    // if only one side were null).
    if (c.power === null || c.toughness === null) continue;
    const p = c.power;
    c.power = c.toughness;
    c.toughness = p;
  }
};
