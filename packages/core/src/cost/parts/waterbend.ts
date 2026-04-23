// SPDX-License-Identifier: GPL-3.0-or-later
// Forge's CostWaterbend is a CostPartMana specialization storing the raw mana
// string as `maxWaterbend`. SP1 keeps both the parsed ManaCost and the source
// string so SP3 can round-trip either form.
import { ManaCost, type ManaCostJSON } from "../../mana/cost.js";
import { CostPart, CostPartRegistry } from "../cost.js";

export class CostWaterbend extends CostPart {
  readonly kind = "waterbend";
  readonly cost: ManaCost;
  constructor(readonly mana: string) {
    super();
    this.cost = ManaCost.parse(mana);
  }
  toJSON(): { kind: string; mana: string; cost: ManaCostJSON } {
    return { kind: this.kind, mana: this.mana, cost: this.cost.toJSON() };
  }
}
CostPartRegistry.register("waterbend", (d) => new CostWaterbend(d.mana as string));
