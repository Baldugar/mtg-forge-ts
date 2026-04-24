// SPDX-License-Identifier: GPL-3.0-or-later
// CostSacrifice — payment of a sacrifice cost ("Sac <filter>" syntax).
// M4 stub: the sacrifice target selection grammar (Valid$ filters) is deferred
// to Part D. This implementation registers the handler so parseCostString can
// classify "Sac Creature" etc., but pay() throws NotImplemented so the engine
// never actually executes it in M4. Part D will replace with a real
// target-selection decision yield.
import type { EngineYield } from "../../action/engine-yield.js";
import { costPartRegistry } from "./cost-part-registry.js";
import type { CostPart, CostPartReceipt, CostPaymentContext } from "./cost-part.js";

const SAC_RE = /^sac\s+(.+)$/i;

function parseSacFilter(raw: string): string {
  const m = SAC_RE.exec(raw);
  if (!m || !m[1]) throw new Error(`CostSacrifice: cannot parse filter from "${raw}"`);
  return m[1].trim();
}

export const CostSacrifice: CostPart = {
  handlerKey: "Sacrifice",

  canPay(ctx: CostPaymentContext): boolean {
    // M4 stub: we cannot determine payability without the target grammar.
    // Return true conservatively so parseCostString can at least classify the
    // cost; CastPipeline will hit the NotImplemented error in pay() before
    // committing. Call parseSacFilter to validate syntax eagerly.
    parseSacFilter(ctx.raw);
    return true;
  },

  // biome-ignore lint/correctness/useYield: always-throw body — no yield reachable before throw
  *pay(ctx: CostPaymentContext): Generator<EngineYield, CostPartReceipt, unknown> {
    const filter = parseSacFilter(ctx.raw);
    throw new Error(
      `CostSacrifice.pay: sacrifice target selection for filter "${filter}" is deferred to Part D — requires target filter grammar`,
    );
  },

  undo(_receipt: CostPartReceipt, _ctx: CostPaymentContext): void {
    // M4 stub: pay always throws so undo is never reached.
    throw new Error("CostSacrifice.undo: deferred to Part D");
  },
};

costPartRegistry.register(CostSacrifice);
