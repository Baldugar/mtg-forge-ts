// SPDX-License-Identifier: GPL-3.0-or-later
// Forge's CostUntap has no constructor parameters — it untaps the source card.
import { CostPart, CostPartRegistry } from "../cost.js";

export class CostUntap extends CostPart {
  readonly kind = "untap";
  toJSON(): { kind: string } {
    return { kind: this.kind };
  }
}
CostPartRegistry.register("untap", () => new CostUntap());
