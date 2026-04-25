// SPDX-License-Identifier: GPL-3.0-or-later
// Wave 6 — ReduceCost handler. "Spells that match the filter cost {N} less
// to cast." Forge DSL examples:
//   S:Mode$ ReduceCost | ValidCard$ Card.Black | Type$ Spell | Activator$ You | Amount$ 1
//   S:Mode$ ReduceCost | ValidCard$ Creature   | Type$ Spell | Activator$ You | Amount$ 1
//
// Produces a costModification StaticAbility whose describe() returns a
// CostModEffect with delta.generic = -Amount and a filter built from the
// ValidCard$ / Type$ / Activator$ params.
//
// Edge cases (deferred — handler throws so unsupported scripts fail loud):
//   - Non-numeric Amount$ (e.g. SVar references, Count$, X).
//   - MinMana$ (per-spell floor; we cap at 0 in apply-cost-mods.ts).
//   - OnlyFirstSpell$ / AffectedZone$ — not yet wired into the filter.
import type { StaticAbility, StaticAst } from "@mtg-forge-ts/core";
import type { CostModEffect } from "../../statics/cost-mod-contributor.js";
import { buildCostModFilter } from "../cost-mod-filter.js";
import {
  StaticHandler,
  type StaticHandlerCtx,
  normalizeActiveInZones,
  staticHandlerRegistry,
} from "../static-handler.js";

export class ReduceCostHandler extends StaticHandler {
  static override readonly mode = "ReduceCost" as const;

  override build(ast: StaticAst, ctx: StaticHandlerCtx): StaticAbility {
    const params = ast.params;
    const amountParam = params.Amount;
    const amountRaw = amountParam && amountParam.kind === "literal" ? amountParam.raw : "0";
    // MVP: numeric Amount only. Forge supports SVar/Count expressions but those
    // need richer evaluation; flag and defer.
    const amount = Number.parseInt(amountRaw, 10);
    if (!Number.isFinite(amount) || amount < 0) {
      throw new Error(`ReduceCostHandler: non-numeric Amount$ "${amountRaw}" not yet supported`);
    }
    const filter = buildCostModFilter(params, ctx.controllerSeat, ctx.sourceCardId);
    const effect: CostModEffect = {
      sourceStaticId: ctx.staticId,
      filter,
      delta: { generic: -amount },
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
