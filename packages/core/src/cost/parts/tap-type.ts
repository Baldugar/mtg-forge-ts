// SPDX-License-Identifier: GPL-3.0-or-later
// Forge derives canTapSource from `costHasTapSource` at construction time;
// SP1 stores the final boolean so the JSON shape is unambiguous.
import { CostPart, CostPartRegistry } from "../cost.js";

export class CostTapType extends CostPart {
  readonly kind = "tapType";
  constructor(
    readonly amount: string,
    readonly type: string,
    readonly description: string | undefined,
    readonly canTapSource: boolean,
  ) {
    super();
  }
  toJSON(): {
    kind: string;
    amount: string;
    type: string;
    description?: string;
    canTapSource: boolean;
  } {
    const out: {
      kind: string;
      amount: string;
      type: string;
      description?: string;
      canTapSource: boolean;
    } = {
      kind: this.kind,
      amount: this.amount,
      type: this.type,
      canTapSource: this.canTapSource,
    };
    if (this.description !== undefined) out.description = this.description;
    return out;
  }
}
CostPartRegistry.register(
  "tapType",
  (d) =>
    new CostTapType(
      d.amount as string,
      d.type as string,
      d.description as string | undefined,
      d.canTapSource as boolean,
    ),
);
