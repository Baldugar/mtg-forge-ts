// SPDX-License-Identifier: GPL-3.0-or-later
import type { CounterType } from "../../counter-type.js";
import { CostPart, CostPartRegistry } from "../cost.js";

export class CostPutCounter extends CostPart {
  readonly kind = "putCounter";
  constructor(
    readonly amount: string,
    readonly counter: CounterType,
    readonly type: string,
    readonly description?: string,
  ) {
    super();
  }
  toJSON(): { kind: string; amount: string; counter: CounterType; type: string; description?: string } {
    const out: {
      kind: string;
      amount: string;
      counter: CounterType;
      type: string;
      description?: string;
    } = {
      kind: this.kind,
      amount: this.amount,
      counter: this.counter,
      type: this.type,
    };
    if (this.description !== undefined) out.description = this.description;
    return out;
  }
}
CostPartRegistry.register(
  "putCounter",
  (d) =>
    new CostPutCounter(
      d.amount as string,
      d.counter as CounterType,
      d.type as string,
      d.description as string | undefined,
    ),
);
