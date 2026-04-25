// SPDX-License-Identifier: GPL-3.0-or-later
// Wave 6 — RaiseCost handler. Symmetric to ReduceCost: spells matching the
// filter cost {N} more (positive generic delta).
//
// Forge DSL examples:
//   S:Mode$ RaiseCost | ValidCard$ Spell | Activator$ Opponent | Amount$ 2
//     "Spells your opponents cast cost {2} more to cast." (Sphere of Resistance-ish)
//   S:Mode$ RaiseCost | ValidCard$ Creature.YouCtrl | Type$ Ability | Amount$ 1
//     "Activated abilities of your creatures cost {1} more."
//
// Same Amount$ MVP constraint as ReduceCost: numeric only.
import type { StaticAbility, StaticAst } from "@mtg-forge-ts/core";
import type { CostModEffect } from "../../statics/cost-mod-contributor.js";
import { buildCostModFilter } from "../cost-mod-filter.js";
import {
  StaticHandler,
  type StaticHandlerCtx,
  normalizeActiveInZones,
  staticHandlerRegistry,
} from "../static-handler.js";

export class RaiseCostHandler extends StaticHandler {
  static override readonly mode = "RaiseCost" as const;

  override build(ast: StaticAst, ctx: StaticHandlerCtx): StaticAbility {
    const params = ast.params;
    const amountParam = params.Amount;
    const amountRaw = amountParam && amountParam.kind === "literal" ? amountParam.raw : "0";
    const amount = Number.parseInt(amountRaw, 10);
    if (!Number.isFinite(amount) || amount < 0) {
      throw new Error(`RaiseCostHandler: non-numeric Amount$ "${amountRaw}" not yet supported`);
    }
    const filter = buildCostModFilter(params, ctx.controllerSeat, ctx.sourceCardId);
    const effect: CostModEffect = {
      sourceStaticId: ctx.staticId,
      filter,
      delta: { generic: +amount },
    };
    const activeInZones = normalizeActiveInZones(ast.activeInZones);
    return {
      id: ctx.staticId,
      kind: "static",
      sourceCardId: ctx.sourceCardId,
      activeInZones,
      timestamp: ctx.game.newEntityId(),
      controllerSeatAtReg: ctx.controllerSeat,
      category: "costModification",
      mode: "RaiseCost",
      describe: () => effect,
    };
  }
}

staticHandlerRegistry.register(RaiseCostHandler);
