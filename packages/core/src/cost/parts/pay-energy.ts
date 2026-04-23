// SPDX-License-Identifier: GPL-3.0-or-later
import { CostPart, CostPartRegistry } from "../cost.js";

export class CostPayEnergy extends CostPart {
  readonly kind = "payEnergy";
  constructor(readonly amount: string) {
    super();
  }
  toJSON(): { kind: string; amount: string } {
    return { kind: this.kind, amount: this.amount };
  }
}
CostPartRegistry.register("payEnergy", (d) => new CostPayEnergy(d.amount as string));
