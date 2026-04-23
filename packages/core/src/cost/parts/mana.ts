// SPDX-License-Identifier: GPL-3.0-or-later
// Port of Forge's CostPartMana: the mana component of any spell or ability
// cost. The `restriction` param in Forge's string constructor is decomposed
// here into three discrete booleans plus xMin (derived from "XMin<N>").
import { ManaCost } from "../../mana/cost.js";
import type { ManaSymbol } from "../../mana/symbol.js";
import { CostPart, CostPartRegistry } from "../cost.js";

export class CostPartMana extends CostPart {
  readonly kind = "mana";
  constructor(
    readonly cost: ManaCost,
    readonly xMin: number = 0,
    readonly isExiledCreatureCost: boolean = false,
    readonly isEnchantedCreatureCost: boolean = false,
    readonly isCostPayAnyNumberOfTimes: boolean = false,
  ) {
    super();
  }
  toJSON(): {
    kind: string;
    cost: { symbols: ManaSymbol[] };
    xMin: number;
    isExiledCreatureCost: boolean;
    isEnchantedCreatureCost: boolean;
    isCostPayAnyNumberOfTimes: boolean;
  } {
    return {
      kind: this.kind,
      cost: this.cost.toJSON(),
      xMin: this.xMin,
      isExiledCreatureCost: this.isExiledCreatureCost,
      isEnchantedCreatureCost: this.isEnchantedCreatureCost,
      isCostPayAnyNumberOfTimes: this.isCostPayAnyNumberOfTimes,
    };
  }
}
CostPartRegistry.register(
  "mana",
  (d) =>
    new CostPartMana(
      ManaCost.fromJSON(d.cost as Parameters<typeof ManaCost.fromJSON>[0]),
      d.xMin as number,
      d.isExiledCreatureCost as boolean,
      d.isEnchantedCreatureCost as boolean,
      d.isCostPayAnyNumberOfTimes as boolean,
    ),
);
