// SPDX-License-Identifier: GPL-3.0-or-later
// Forge derives canUntapSource from `hasUntapInPrice` at construction time;
// SP1 stores the final boolean so the JSON shape is unambiguous.
import { CostPart, CostPartRegistry } from "../cost.js";

export class CostUntapType extends CostPart {
  readonly kind = "untapType";
  constructor(
    readonly amount: string,
    readonly type: string,
    readonly description: string | undefined,
    readonly canUntapSource: boolean,
  ) {
    super();
  }
  toJSON(): {
    kind: string;
    amount: string;
    type: string;
    description?: string;
    canUntapSource: boolean;
  } {
    const out: {
      kind: string;
      amount: string;
      type: string;
      description?: string;
      canUntapSource: boolean;
    } = {
      kind: this.kind,
      amount: this.amount,
      type: this.type,
      canUntapSource: this.canUntapSource,
    };
    if (this.description !== undefined) out.description = this.description;
    return out;
  }
}
CostPartRegistry.register(
  "untapType",
  (d) =>
    new CostUntapType(
      d.amount as string,
      d.type as string,
      d.description as string | undefined,
      d.canUntapSource as boolean,
    ),
);
