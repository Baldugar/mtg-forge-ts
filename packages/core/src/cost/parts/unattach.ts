// SPDX-License-Identifier: GPL-3.0-or-later
// Forge's CostUnattach hardcodes amount="1" and takes only (type, desc).
import { CostPart, CostPartRegistry } from "../cost.js";

export class CostUnattach extends CostPart {
  readonly kind = "unattach";
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
  "unattach",
  (d) => new CostUnattach(d.type as string, d.description as string | undefined),
);
