// SPDX-License-Identifier: GPL-3.0-or-later
import type { Color } from "../color.js";
import type { EntityId } from "../ids.js";

export type ManaRestriction =
  | "none"
  | "creatureSpells"
  | "onlyThisTurn"
  | "mustSpendOrLoseLife"
  | "artifactSpells";

export class ManaShard {
  constructor(
    readonly color: Color | null,
    readonly sourceId: EntityId | null,
    readonly isSnow: boolean,
    readonly restriction: ManaRestriction,
  ) {}

  static colored(c: Color, opts: { sourceId?: EntityId; restriction?: ManaRestriction } = {}): ManaShard {
    return new ManaShard(c, opts.sourceId ?? null, false, opts.restriction ?? "none");
  }

  static colorless(opts: { sourceId?: EntityId } = {}): ManaShard {
    return new ManaShard(null, opts.sourceId ?? null, false, "none");
  }

  static snow(c: Color | null, opts: { sourceId?: EntityId } = {}): ManaShard {
    return new ManaShard(c, opts.sourceId ?? null, true, "none");
  }

  toJSON(): {
    color: Color | null;
    sourceId: EntityId | null;
    isSnow: boolean;
    restriction: ManaRestriction;
  } {
    return {
      color: this.color,
      sourceId: this.sourceId,
      isSnow: this.isSnow,
      restriction: this.restriction,
    };
  }

  static fromJSON(s: ReturnType<ManaShard["toJSON"]>): ManaShard {
    return new ManaShard(s.color, s.sourceId as EntityId | null, s.isSnow, s.restriction);
  }
}
