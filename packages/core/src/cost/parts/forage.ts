// SPDX-License-Identifier: GPL-3.0-or-later
// Forge's CostForage has no constructor parameters — the cost is "Forage"
// (exile 3 from graveyard OR sacrifice a Food). SP1 data shell is therefore
// an empty marker.
import { CostPart, CostPartRegistry } from "../cost.js";

export class CostForage extends CostPart {
  readonly kind = "forage";
  toJSON(): { kind: string } {
    return { kind: this.kind };
  }
}
CostPartRegistry.register("forage", () => new CostForage());
