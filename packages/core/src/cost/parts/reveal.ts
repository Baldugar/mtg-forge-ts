// SPDX-License-Identifier: GPL-3.0-or-later
// Forge's CostReveal defaults revealFrom to [Hand]; the 4-arg constructor lets
// callers specify a comma-separated list (parsed via ZoneType.listValueOf).
// SP1 treats both ways uniformly: callers supply the final ZoneType[].
import type { ZoneType } from "../../zone.js";
import { CostPart, CostPartRegistry } from "../cost.js";

export class CostReveal extends CostPart {
  readonly kind = "reveal";
  constructor(
    readonly amount: string,
    readonly type: string,
    readonly description: string | undefined,
    readonly revealFrom: readonly ZoneType[],
  ) {
    super();
  }
  toJSON(): {
    kind: string;
    amount: string;
    type: string;
    description?: string;
    revealFrom: ZoneType[];
  } {
    const out: {
      kind: string;
      amount: string;
      type: string;
      description?: string;
      revealFrom: ZoneType[];
    } = {
      kind: this.kind,
      amount: this.amount,
      type: this.type,
      revealFrom: [...this.revealFrom],
    };
    if (this.description !== undefined) out.description = this.description;
    return out;
  }
}
CostPartRegistry.register(
  "reveal",
  (d) =>
    new CostReveal(
      d.amount as string,
      d.type as string,
      d.description as string | undefined,
      d.revealFrom as ZoneType[],
    ),
);
