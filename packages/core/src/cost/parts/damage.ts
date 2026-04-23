// SPDX-License-Identifier: GPL-3.0-or-later
import { CostPart, CostPartRegistry } from "../cost.js";

export class CostDamage extends CostPart {
  readonly kind = "damage";
  constructor(readonly amount: string) {
    super();
  }
  toJSON(): { kind: string; amount: string } {
    return { kind: this.kind, amount: this.amount };
  }
}
CostPartRegistry.register("damage", (d) => new CostDamage(d.amount as string));
