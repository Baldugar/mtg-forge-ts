// SPDX-License-Identifier: GPL-3.0-or-later
// Forge encodes "all/each players" as Integer.MAX_VALUE in cntPlayers. Port as
// `number`; SP3 decision layer interprets the sentinel.
import { CostPart, CostPartRegistry } from "../cost.js";

export class CostGainLife extends CostPart {
  readonly kind = "gainLife";
  constructor(
    readonly amount: string,
    readonly playerSelector: string,
    readonly cntPlayers: number,
  ) {
    super();
  }
  toJSON(): { kind: string; amount: string; playerSelector: string; cntPlayers: number } {
    return {
      kind: this.kind,
      amount: this.amount,
      playerSelector: this.playerSelector,
      cntPlayers: this.cntPlayers,
    };
  }
}
CostPartRegistry.register(
  "gainLife",
  (d) => new CostGainLife(d.amount as string, d.playerSelector as string, d.cntPlayers as number),
);
