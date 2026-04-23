// SPDX-License-Identifier: GPL-3.0-or-later
// Forge stores `sides` in the `type` slot (a digit-string like "6", "20")
// and adds its own `resultSVar` for where the rolled value is saved.
import { CostPart, CostPartRegistry } from "../cost.js";

export class CostRollDice extends CostPart {
  readonly kind = "rollDice";
  constructor(
    readonly amount: string,
    readonly sides: string,
    readonly resultSVar: string,
    readonly description?: string,
  ) {
    super();
  }
  toJSON(): {
    kind: string;
    amount: string;
    sides: string;
    resultSVar: string;
    description?: string;
  } {
    const out: {
      kind: string;
      amount: string;
      sides: string;
      resultSVar: string;
      description?: string;
    } = {
      kind: this.kind,
      amount: this.amount,
      sides: this.sides,
      resultSVar: this.resultSVar,
    };
    if (this.description !== undefined) out.description = this.description;
    return out;
  }
}
CostPartRegistry.register(
  "rollDice",
  (d) =>
    new CostRollDice(
      d.amount as string,
      d.sides as string,
      d.resultSVar as string,
      d.description as string | undefined,
    ),
);
