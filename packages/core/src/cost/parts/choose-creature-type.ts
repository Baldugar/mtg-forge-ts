// SPDX-License-Identifier: GPL-3.0-or-later
import { CostPart, CostPartRegistry } from "../cost.js";

export class CostChooseCreatureType extends CostPart {
  readonly kind = "chooseCreatureType";
  constructor(readonly amount: string) {
    super();
  }
  toJSON(): { kind: string; amount: string } {
    return { kind: this.kind, amount: this.amount };
  }
}
CostPartRegistry.register("chooseCreatureType", (d) => new CostChooseCreatureType(d.amount as string));
