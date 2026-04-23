// SPDX-License-Identifier: GPL-3.0-or-later
// Forge's CostRevealChosen hardcodes amount="1" and takes only (type, desc).
// SP1 keeps the explicit fields so JSON serialization remains self-describing.
import { CostPart, CostPartRegistry } from "../cost.js";

export class CostRevealChosen extends CostPart {
  readonly kind = "revealChosen";
  constructor(
    readonly type: string,
    readonly description?: string,
  ) {
    super();
  }
  toJSON(): { kind: string; type: string; description?: string } {
    const out: { kind: string; type: string; description?: string } = {
      kind: this.kind,
      type: this.type,
    };
    if (this.description !== undefined) out.description = this.description;
    return out;
  }
}
CostPartRegistry.register(
  "revealChosen",
  (d) => new CostRevealChosen(d.type as string, d.description as string | undefined),
);
