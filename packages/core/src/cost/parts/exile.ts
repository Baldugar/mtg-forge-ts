// SPDX-License-Identifier: GPL-3.0-or-later
// CostExile carries a list of origin zones and a zoneRestriction code
// (1 = payer's zone, 0 = same-zone-per-player, -1 = any). Forge picks sensible
// defaults (Battlefield, zoneRestriction=1) when `from` is empty; SP1 preserves
// both inputs verbatim so the SP3 DSL parser can decide.
import type { ZoneType } from "../../zone.js";
import { CostPart, CostPartRegistry } from "../cost.js";

export class CostExile extends CostPart {
  readonly kind = "exile";
  constructor(
    readonly amount: string,
    readonly type: string,
    readonly description: string | undefined,
    readonly from: readonly ZoneType[],
    readonly zoneRestriction: number,
  ) {
    super();
  }
  toJSON(): {
    kind: string;
    amount: string;
    type: string;
    description?: string;
    from: ZoneType[];
    zoneRestriction: number;
  } {
    const out: {
      kind: string;
      amount: string;
      type: string;
      description?: string;
      from: ZoneType[];
      zoneRestriction: number;
    } = {
      kind: this.kind,
      amount: this.amount,
      type: this.type,
      from: [...this.from],
      zoneRestriction: this.zoneRestriction,
    };
    if (this.description !== undefined) out.description = this.description;
    return out;
  }
}
CostPartRegistry.register(
  "exile",
  (d) =>
    new CostExile(
      d.amount as string,
      d.type as string,
      d.description as string | undefined,
      d.from as ZoneType[],
      d.zoneRestriction as number,
    ),
);
