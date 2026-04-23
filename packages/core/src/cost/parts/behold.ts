// SPDX-License-Identifier: GPL-3.0-or-later
import { CostPart, CostPartRegistry } from "../cost.js";

export class CostBehold extends CostPart {
  readonly kind = "behold";
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
  "behold",
  (d) => new CostBehold(d.amount as string, d.type as string, d.description as string | undefined),
);
