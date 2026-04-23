// SPDX-License-Identifier: GPL-3.0-or-later
import { CostPart, CostPartRegistry } from "../cost.js";

export class CostAddMana extends CostPart {
  readonly kind = "addMana";
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
  "addMana",
  (d) => new CostAddMana(d.amount as string, d.type as string, d.description as string | undefined),
);
