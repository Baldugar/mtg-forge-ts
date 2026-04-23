// SPDX-License-Identifier: GPL-3.0-or-later
import { CostPart, CostPartRegistry } from "../cost.js";

export class CostExert extends CostPart {
  readonly kind = "exert";
  constructor(
    readonly amount: string,
    readonly type: string,
    readonly description?: string,
  ) {
    super();
  }
  toJSON(): { kind: string; amount: string; type: string; description?: string } {
    const out: { kind: string; amount: string; type: string; description?: string } = {
      kind: this.kind,
      amount: this.amount,
      type: this.type,
    };
    if (this.description !== undefined) out.description = this.description;
    return out;
  }
}
CostPartRegistry.register(
  "exert",
  (d) => new CostExert(d.amount as string, d.type as string, d.description as string | undefined),
);
