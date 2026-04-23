// SPDX-License-Identifier: GPL-3.0-or-later
// Forge's CostPromiseGift carries no constructor inputs — it is a marker that
// activates the "choose an opponent to receive a gift" flow.
import { CostPart, CostPartRegistry } from "../cost.js";

export class CostPromiseGift extends CostPart {
  readonly kind = "promiseGift";
  toJSON(): { kind: string } {
    return { kind: this.kind };
  }
}
CostPartRegistry.register("promiseGift", () => new CostPromiseGift());
