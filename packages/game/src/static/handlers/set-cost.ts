// SPDX-License-Identifier: GPL-3.0-or-later
// Wave 11 — SetCost handler.
//
// Trinisphere-style "this spell costs at least N mana to cast". Differs from
// ReduceCost / RaiseCost in that the result of all generic deltas + color
// adjustments is FLOORED at the Amount$ value rather than being an additive
// delta.
//
// Forge DSL example (Trinisphere):
//   S:Mode$ SetCost | ValidCard$ Card | Type$ Spell | Amount$ 3 | RaiseTo$ True
//     | IsPresent$ Card.Self+untapped
//
// MVP: RaiseTo$ True is the implicit semantics (top-up to the floor; never
// reduce). RaiseTo$ False (used by very few cards to FORCE a fixed mana
// value regardless of base cost) is not implemented — none of the SP3
// flagship cards use it.
import type { SVarAst, StaticAbility, StaticAst } from "@mtg-forge-ts/core";
import type { Game } from "../../game.js";
import type { CostModEffect } from "../../statics/cost-mod-contributor.js";
import { buildCostModFilter } from "../cost-mod-filter.js";
import {
  StaticHandler,
  type StaticHandlerCtx,
  normalizeActiveInZones,
  staticHandlerRegistry,
} from "../static-handler.js";
import { buildAmountResolver } from "./cost-mod-helpers.js";

export class SetCostHandler extends StaticHandler {
  static override readonly mode = "SetCost" as const;

  override build(ast: StaticAst, ctx: StaticHandlerCtx): StaticAbility {
    const params = ast.params;
    const sourceCard = ctx.game.cards.get(ctx.sourceCardId);
    const def = sourceCard?.paperCard.definition;
    const svars = (def?.svars ?? new Map()) as ReadonlyMap<string, SVarAst>;

    const amountResolver = buildAmountResolver(params.Amount, svars, ctx);
    const baseFilter = buildCostModFilter(params, ctx.controllerSeat, ctx.sourceCardId);

    // describe() is called per gather invocation. We build a fresh effect
    // each time so per-cast Amount$ resolution lives in scope. Mutating
    // through a closure-held holder lets us evaluate the amount inside
    // the filter (where item + game are in scope) and have applyCostMods
    // read the resolved value via the readonly setMinTotal field.
    const describe = (): CostModEffect => {
      const holder: { setMinTotal: number } = { setMinTotal: 0 };
      const wrappingFilter = (item: unknown, game: Game): boolean => {
        if (!baseFilter(item, game)) return false;
        holder.setMinTotal = Math.max(0, amountResolver(item, game));
        return true;
      };
      const effect: CostModEffect = Object.defineProperty(
        {
          sourceStaticId: ctx.staticId,
          filter: wrappingFilter,
          delta: {},
        } as CostModEffect,
        "setMinTotal",
        {
          get: () => holder.setMinTotal,
          enumerable: true,
        },
      ) as CostModEffect;
      return effect;
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
      mode: "SetCost",
      describe,
    };
  }
}

staticHandlerRegistry.register(SetCostHandler);
