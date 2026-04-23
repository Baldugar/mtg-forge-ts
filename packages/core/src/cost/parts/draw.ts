// SPDX-License-Identifier: GPL-3.0-or-later
// Forge's CostDraw encodes the drawer via `playerSelector` (a CardTraitBase
// isValid string, e.g. "You" or "Opponent"), supplied as the `type` parameter
// of the parent CostPart. No separate "description" is used.
import { CostPart, CostPartRegistry } from "../cost.js";

export class CostDraw extends CostPart {
  readonly kind = "draw";
  constructor(
    readonly amount: string,
    readonly playerSelector: string,
  ) {
    super();
  }
  toJSON(): { kind: string; amount: string; playerSelector: string } {
    return { kind: this.kind, amount: this.amount, playerSelector: this.playerSelector };
  }
}
CostPartRegistry.register("draw", (d) => new CostDraw(d.amount as string, d.playerSelector as string));
