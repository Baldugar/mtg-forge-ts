// SPDX-License-Identifier: GPL-3.0-or-later
// Forge permits a null counter ("any counter type") and carries a list of
// source zones. Preserved verbatim for SP1.
import type { CounterType } from "../../counter-type.js";
import type { ZoneType } from "../../zone.js";
import { CostPart, CostPartRegistry } from "../cost.js";

export class CostRemoveCounter extends CostPart {
  readonly kind = "removeCounter";
  constructor(
    readonly amount: string,
    readonly counter: CounterType | undefined,
    readonly type: string,
    readonly description: string | undefined,
    readonly zone: readonly ZoneType[],
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
    zone: ZoneType[];
    oneOrMore: boolean;
  } {
    const out: {
      kind: string;
      amount: string;
      counter?: CounterType;
      type: string;
      description?: string;
      zone: ZoneType[];
      oneOrMore: boolean;
    } = {
      kind: this.kind,
      amount: this.amount,
      type: this.type,
      zone: [...this.zone],
      oneOrMore: this.oneOrMore,
    };
    if (this.counter !== undefined) out.counter = this.counter;
    if (this.description !== undefined) out.description = this.description;
    return out;
  }
}
CostPartRegistry.register(
  "removeCounter",
  (d) =>
    new CostRemoveCounter(
      d.amount as string,
      d.counter as CounterType | undefined,
      d.type as string,
      d.description as string | undefined,
      d.zone as ZoneType[],
      d.oneOrMore as boolean,
    ),
);
