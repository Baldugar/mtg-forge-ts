// SPDX-License-Identifier: GPL-3.0-or-later
// ManaProduced models produced mana in a pool: a color (or null for colorless),
// a source entity, and an optional payment restriction. This is the pool-side
// analog. The cost-side analog (Forge's ManaCostShard) will live on ManaCost
// when the Forge-faithful shard kinds are added.
import type { Color } from "../color.js";
import { type EntityId, mkEntityId } from "../ids.js";

export type ManaProductionRestriction =
  | "none"
  | "creatureSpells"
  | "onlyThisTurn"
  | "mustSpendOrLoseLife"
  | "artifactSpells"
  // Wave 29 — Powerstone token (CR 107.4d / Brothers' War). The {C} mana
  // produced "can't be spent to cast a nonartifact spell." Captured here
  // as a positive form ("only artifact spells / activated abilities of
  // artifact sources, plus generic costs"); the solver-side filter is
  // wired progressively (TODO in cost-mana solver). This restriction
  // is the data-layer half — token-database tags Powerstone's mana
  // ability with it so the field round-trips through snapshots.
  | "nonCreatureNonActivated";

export class ManaProduced {
  constructor(
    readonly color: Color | null,
    readonly sourceId: EntityId | null,
    readonly isSnow: boolean,
    readonly restriction: ManaProductionRestriction,
  ) {}

  static colored(
    c: Color,
    opts: { sourceId?: EntityId; restriction?: ManaProductionRestriction } = {},
  ): ManaProduced {
    return new ManaProduced(c, opts.sourceId ?? null, false, opts.restriction ?? "none");
  }

  static colorless(
    opts: { sourceId?: EntityId; restriction?: ManaProductionRestriction } = {},
  ): ManaProduced {
    return new ManaProduced(null, opts.sourceId ?? null, false, opts.restriction ?? "none");
  }

  static snow(
    c: Color | null,
    opts: { sourceId?: EntityId; restriction?: ManaProductionRestriction } = {},
  ): ManaProduced {
    return new ManaProduced(c, opts.sourceId ?? null, true, opts.restriction ?? "none");
  }

  toJSON(): {
    color: Color | null;
    sourceId: EntityId | null;
    isSnow: boolean;
    restriction: ManaProductionRestriction;
  } {
    return {
      color: this.color,
      sourceId: this.sourceId,
      isSnow: this.isSnow,
      restriction: this.restriction,
    };
  }

  static fromJSON(s: ReturnType<ManaProduced["toJSON"]>): ManaProduced {
    // WHY: route sourceId through mkEntityId so bad wire data (negative,
    // non-integer, NaN) throws instead of silently branding a garbage number.
    const sourceId = s.sourceId === null ? null : mkEntityId(s.sourceId as number);
    return new ManaProduced(s.color, sourceId, s.isSnow, s.restriction);
  }
}
