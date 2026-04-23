// SPDX-License-Identifier: GPL-3.0-or-later
import { CostPart, CostPartRegistry } from "../cost.js";

export class CostCollectEvidence extends CostPart {
  readonly kind = "collectEvidence";
  constructor(readonly amount: string) {
    super();
  }
  toJSON(): { kind: string; amount: string } {
    return { kind: this.kind, amount: this.amount };
  }
}
CostPartRegistry.register("collectEvidence", (d) => new CostCollectEvidence(d.amount as string));
