// SPDX-License-Identifier: GPL-3.0-or-later
// Forge defaults `from` to ZoneType.Hand when null — preserved here by
// storing the caller's raw value; SP3 DSL populates the default at parse time.
import type { ZoneType } from "../../zone.js";
import { CostPart, CostPartRegistry } from "../cost.js";

export class CostPutCardToLib extends CostPart {
  readonly kind = "putCardToLib";
  constructor(
    readonly amount: string,
    readonly libPosition: string,
    readonly type: string,
    readonly description: string | undefined,
    readonly from: ZoneType,
    readonly sameZone: boolean = false,
  ) {
    super();
  }
  toJSON(): {
    kind: string;
    amount: string;
    libPosition: string;
    type: string;
    description?: string;
    from: ZoneType;
    sameZone: boolean;
  } {
    const out: {
      kind: string;
      amount: string;
      libPosition: string;
      type: string;
      description?: string;
      from: ZoneType;
      sameZone: boolean;
    } = {
      kind: this.kind,
      amount: this.amount,
      libPosition: this.libPosition,
      type: this.type,
      from: this.from,
      sameZone: this.sameZone,
    };
    if (this.description !== undefined) out.description = this.description;
    return out;
  }
}
CostPartRegistry.register(
  "putCardToLib",
  (d) =>
    new CostPutCardToLib(
      d.amount as string,
      d.libPosition as string,
      d.type as string,
      d.description as string | undefined,
      d.from as ZoneType,
      d.sameZone as boolean,
    ),
);
