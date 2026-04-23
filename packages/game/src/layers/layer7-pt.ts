// SPDX-License-Identifier: GPL-3.0-or-later
// CR 613.1g — Layer 7 power/toughness sublayers.
//   7a: characteristic-defining P/T (e.g. "*/* equal to X").
//   7b: set P/T ("becomes 3/3").
//   7c: modify P/T ("+2/+0 until end of turn").
//   7d: counters (+1/+1, -1/-1, and P/T-adjusting counters).
//   7e: switch P/T.
// Within each sublayer, effects apply in timestamp order.
//
// Forge reference: StaticAbilityContinuous (setPT / addPT); Card#getNetPower
// and Card#getNetToughness consolidate counter-driven +N/+N.
import type { Characteristics, EntityId } from "@mtg-forge-ts/core";

export interface Layer7aEffect {
  readonly kind: "cdaSet";
  readonly power: number;
  readonly toughness: number;
  readonly timestamp: number;
  readonly sourceAbilityId: EntityId | null;
}

export interface Layer7bEffect {
  readonly kind: "set";
  readonly power: number;
  readonly toughness: number;
  readonly timestamp: number;
  readonly sourceAbilityId: EntityId | null;
}

export interface Layer7cEffect {
  readonly kind: "modify";
  readonly powerDelta: number;
  readonly toughnessDelta: number;
  readonly timestamp: number;
  readonly sourceAbilityId: EntityId | null;
}

export type Layer7dEffect =
  | {
      readonly kind: "plusOnePlusOne";
      readonly count: number;
      readonly timestamp: number;
      readonly sourceAbilityId: EntityId | null;
    }
  | {
      readonly kind: "minusOneMinusOne";
      readonly count: number;
      readonly timestamp: number;
      readonly sourceAbilityId: EntityId | null;
    }
  | {
      readonly kind: "ptCounter";
      readonly powerPer: number;
      readonly toughnessPer: number;
      readonly count: number;
      readonly timestamp: number;
      readonly sourceAbilityId: EntityId | null;
    };

export interface Layer7eEffect {
  readonly kind: "switch";
  readonly timestamp: number;
  readonly sourceAbilityId: EntityId | null;
}

export const applyLayer7a = (c: Characteristics, effects: readonly Layer7aEffect[]): void => {
  const ordered = [...effects].sort((a, b) => a.timestamp - b.timestamp);
  for (const e of ordered) {
    c.power = e.power;
    c.toughness = e.toughness;
  }
};

export const applyLayer7b = (c: Characteristics, effects: readonly Layer7bEffect[]): void => {
  const ordered = [...effects].sort((a, b) => a.timestamp - b.timestamp);
  for (const e of ordered) {
    c.power = e.power;
    c.toughness = e.toughness;
  }
};

export const applyLayer7c = (c: Characteristics, effects: readonly Layer7cEffect[]): void => {
  const ordered = [...effects].sort((a, b) => a.timestamp - b.timestamp);
  for (const e of ordered) {
    c.power = (c.power ?? 0) + e.powerDelta;
    c.toughness = (c.toughness ?? 0) + e.toughnessDelta;
  }
};

export const applyLayer7d = (c: Characteristics, effects: readonly Layer7dEffect[]): void => {
  const ordered = [...effects].sort((a, b) => a.timestamp - b.timestamp);
  for (const e of ordered) {
    switch (e.kind) {
      case "plusOnePlusOne":
        c.power = (c.power ?? 0) + e.count;
        c.toughness = (c.toughness ?? 0) + e.count;
        break;
      case "minusOneMinusOne":
        c.power = (c.power ?? 0) - e.count;
        c.toughness = (c.toughness ?? 0) - e.count;
        break;
      case "ptCounter":
        c.power = (c.power ?? 0) + e.powerPer * e.count;
        c.toughness = (c.toughness ?? 0) + e.toughnessPer * e.count;
        break;
      default: {
        const _: never = e;
        throw new Error(`applyLayer7d: unreachable ${JSON.stringify(_)}`);
      }
    }
  }
};

export const applyLayer7e = (c: Characteristics, effects: readonly Layer7eEffect[]): void => {
  const ordered = [...effects].sort((a, b) => a.timestamp - b.timestamp);
  for (const _ of ordered) {
    const p = c.power;
    c.power = c.toughness;
    c.toughness = p;
  }
};
