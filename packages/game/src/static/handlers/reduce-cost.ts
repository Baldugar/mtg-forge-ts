// SPDX-License-Identifier: GPL-3.0-or-later
// Wave 6 baseline + Wave 11 completeness — ReduceCost handler.
//
// "Spells/abilities that match the filter cost {N} less to cast/activate."
//
// Forge DSL examples:
//   S:Mode$ ReduceCost | ValidCard$ Card.Black | Type$ Spell | Activator$ You | Amount$ 1
//     (Jet Medallion — black spells you cast cost {1} less)
//   S:Mode$ ReduceCost | ... | Amount$ 2 | MinMana$ 1
//     (Zirda — abilities cost {2} less but never less than {1} mana)
//   S:Mode$ ReduceCost | Type$ Spell | OnlyFirstSpell$ True | Amount$ 2
//     (Acolyte of Bahamut — first Dragon spell each turn costs {2} less)
//   S:Mode$ ReduceCost | ... | Amount$ X with SVar:X:Count$Domain
//     (Yavimaya Sojourner — costs {1} less per basic land type)
//   S:Mode$ ReduceCost | Cost$ W
//     (symmetric to RaiseCost Cost$ — strip a {W} pip if present)
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
  parseMinManaParam,
  parseSubtractSymbolsFromCost,
} from "./cost-mod-helpers.js";

export class ReduceCostHandler extends StaticHandler {
  static override readonly mode = "ReduceCost" as const;

  override build(ast: StaticAst, ctx: StaticHandlerCtx): StaticAbility {
    const params = ast.params;
    const sourceCard = ctx.game.cards.get(ctx.sourceCardId);
    const def = sourceCard?.paperCard.definition;
    const svars = (def?.svars ?? new Map()) as ReadonlyMap<string, SVarAst>;

    const amountResolver = buildAmountResolver(params.Amount, svars, ctx);
    const minMana = parseMinManaParam(params.MinMana);
    const tracker = buildOnlyFirstSpellTracker(params.OnlyFirstSpell, ctx);
    const subtractSymbols = parseSubtractSymbolsFromCost(params.Cost);

    // Wrap the user-provided filter with the once-per-turn guard (if any).
    const baseFilter = buildCostModFilter(params, ctx.controllerSeat, ctx.sourceCardId);
    const filter = (item: unknown, game: Game): boolean => {
      if (!baseFilter(item, game)) return false;
      if (tracker?.alreadyFired(game)) return false;
      return true;
    };

    // Reduce: negate the resolved amount. amountResolver returns positive
    // generic-reduction magnitude; the delta is therefore -amount.
    const dynGeneric = (item: unknown, game: Game): number => {
      const n = amountResolver(item, game);
      return -Math.max(0, n);
    };

    const effect: CostModEffect = {
      sourceStaticId: ctx.staticId,
      filter,
      delta: {
        generic: dynGeneric,
        ...(subtractSymbols !== undefined && subtractSymbols.length > 0 ? { subtractSymbols } : {}),
      },
      ...(minMana !== undefined ? { minMana } : {}),
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
      mode: "ReduceCost",
      describe: () => effect,
    };
  }
}

staticHandlerRegistry.register(ReduceCostHandler);
