// SPDX-License-Identifier: GPL-3.0-or-later
// Wave 6 baseline + Wave 11 completeness — RaiseCost handler. Symmetric to
// ReduceCost: spells matching the filter cost {N} more (positive generic
// delta), or the colored pips listed in Cost$ are appended to the cost.
//
// Forge DSL examples:
//   S:Mode$ RaiseCost | ValidCard$ Spell | Activator$ Opponent | Amount$ 2
//     "Spells your opponents cast cost {2} more to cast." (Sphere of Resistance-ish)
//   S:Mode$ RaiseCost | ValidCard$ Card.White | Cost$ W
//     (Alabaster Leech — white spells cost {W} more)
//   S:Mode$ RaiseCost | Type$ Ability | AffectedZone$ Battlefield | Amount$ 3
//     (Gloom — activated abilities of white enchantments cost {3} more)
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
import {
  buildAmountResolver,
  buildOnlyFirstSpellTracker,
  parseAddSymbolsFromCost,
} from "./cost-mod-helpers.js";

export class RaiseCostHandler extends StaticHandler {
  static override readonly mode = "RaiseCost" as const;

  override build(ast: StaticAst, ctx: StaticHandlerCtx): StaticAbility {
    const params = ast.params;
    const sourceCard = ctx.game.cards.get(ctx.sourceCardId);
    const def = sourceCard?.paperCard.definition;
    const svars = (def?.svars ?? new Map()) as ReadonlyMap<string, SVarAst>;

    const amountResolver = buildAmountResolver(params.Amount, svars, ctx);
    const tracker = buildOnlyFirstSpellTracker(params.OnlyFirstSpell, ctx);
    const addSymbols = parseAddSymbolsFromCost(params.Cost);

    const baseFilter = buildCostModFilter(params, ctx.controllerSeat, ctx.sourceCardId);
    const filter = (item: unknown, game: Game): boolean => {
      if (!baseFilter(item, game)) return false;
      if (tracker?.alreadyFired(game)) return false;
      return true;
    };

    // Raise: pass the resolved amount as positive delta.
    const dynGeneric = (item: unknown, game: Game): number => {
      const n = amountResolver(item, game);
      return Math.max(0, n);
    };

    const effect: CostModEffect = {
      sourceStaticId: ctx.staticId,
      filter,
      delta: {
        generic: dynGeneric,
        ...(addSymbols !== undefined && addSymbols.length > 0 ? { addSymbols } : {}),
      },
      ...(tracker !== null ? { markUsed: tracker.markUsed } : {}),
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
