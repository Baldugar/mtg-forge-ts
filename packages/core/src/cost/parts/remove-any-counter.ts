// SPDX-License-Identifier: GPL-3.0-or-later
// Forge permits a null counter, meaning "any counter type". SP1 preserves that
// with `counter?: CounterType`.
import type { CounterType } from "../../counter-type.js";
import { CostPart, CostPartRegistry } from "../cost.js";

export class CostRemoveAnyCounter extends CostPart {
  readonly kind = "removeAnyCounter";
  constructor(
    readonly amount: string,
    readonly counter: CounterType | undefined,
    readonly type: string,
    readonly description: string | undefined,
    readonly oneOrMore: boolean,
  ) {
    super();
  }
  toJSON(): {
    kind: string;
    amount: string;
    counter?: CounterType;
    type: string;
    description?: string;
    oneOrMore: boolean;
  } {
    const out: {
      kind: string;
      amount: string;
      counter?: CounterType;
      type: string;
      description?: string;
      oneOrMore: boolean;
    } = {
      kind: this.kind,
      amount: this.amount,
      type: this.type,
      oneOrMore: this.oneOrMore,
    };
    if (this.counter !== undefined) out.counter = this.counter;
    if (this.description !== undefined) out.description = this.description;
    return out;
  }
}
CostPartRegistry.register(
  "removeAnyCounter",
  (d) =>
    new CostRemoveAnyCounter(
      d.amount as string,
      d.counter as CounterType | undefined,
      d.type as string,
      d.description as string | undefined,
      d.oneOrMore as boolean,
    ),
);
