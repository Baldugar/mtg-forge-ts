// SPDX-License-Identifier: GPL-3.0-or-later
// Forge's CostBlight is a narrow specialization of CostPutCounter that hard-codes
// `CounterEnumType.M1M1` + `Creature.YouCtrl`. SP1 keeps only the single
// constructor input ("counters") — downstream consumers recover the M1M1 + type
// defaults from the kind discriminator.
import { CostPart, CostPartRegistry } from "../cost.js";

export class CostBlight extends CostPart {
  readonly kind = "blight";
  constructor(readonly counters: string) {
    super();
  }
  toJSON(): { kind: string; counters: string } {
    return { kind: this.kind, counters: this.counters };
  }
}
CostPartRegistry.register("blight", (d) => new CostBlight(d.counters as string));
