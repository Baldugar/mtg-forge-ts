// SPDX-License-Identifier: GPL-3.0-or-later
import { CostPart, CostPartRegistry } from "../cost.js";

export class CostPayLife extends CostPart {
  readonly kind = "payLife";
  constructor(
    readonly amount: string,
    readonly description?: string,
  ) {
    super();
  }
  toJSON(): { kind: string; amount: string; description?: string } {
    const out: { kind: string; amount: string; description?: string } = {
      kind: this.kind,
      amount: this.amount,
    };
    if (this.description !== undefined) out.description = this.description;
    return out;
  }
}
CostPartRegistry.register(
  "payLife",
  (d) => new CostPayLife(d.amount as string, d.description as string | undefined),
);
