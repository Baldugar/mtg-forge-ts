// SPDX-License-Identifier: GPL-3.0-or-later
import { CostPart, CostPartRegistry } from "../cost.js";

export class CostMill extends CostPart {
  readonly kind = "mill";
  constructor(readonly amount: string) {
    super();
  }
  toJSON(): { kind: string; amount: string } {
    return { kind: this.kind, amount: this.amount };
  }
}
CostPartRegistry.register("mill", (d) => new CostMill(d.amount as string));
