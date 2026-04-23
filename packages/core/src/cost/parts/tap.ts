// SPDX-License-Identifier: GPL-3.0-or-later
// Forge's CostTap has no constructor parameters — it taps the source card.
import { CostPart, CostPartRegistry } from "../cost.js";

export class CostTap extends CostPart {
  readonly kind = "tap";
  toJSON(): { kind: string } {
    return { kind: this.kind };
  }
}
CostPartRegistry.register("tap", () => new CostTap());
