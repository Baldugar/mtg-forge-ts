// SPDX-License-Identifier: GPL-3.0-or-later
// ManaProduced models produced mana in a pool: a color (or null for colorless),
// a source entity, and an optional payment restriction. This is the pool-side
// analog. The cost-side analog (Forge's ManaCostShard) will live on ManaCost
// when the Forge-faithful shard kinds are added.
import type { Color } from "../color.js";
import type { EntityId } from "../ids.js";

export type ManaProductionRestriction =
  | "none"
  | "creatureSpells"
  | "onlyThisTurn"
  | "mustSpendOrLoseLife"
  | "artifactSpells";

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

  static colorless(opts: { sourceId?: EntityId } = {}): ManaProduced {
    return new ManaProduced(null, opts.sourceId ?? null, false, "none");
  }

  static snow(c: Color | null, opts: { sourceId?: EntityId } = {}): ManaProduced {
    return new ManaProduced(c, opts.sourceId ?? null, true, "none");
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
    return new ManaProduced(s.color, s.sourceId as EntityId | null, s.isSnow, s.restriction);
  }
}
