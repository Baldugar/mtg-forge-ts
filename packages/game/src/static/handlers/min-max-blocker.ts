// SPDX-License-Identifier: GPL-3.0-or-later
// Wave 50 — MinMaxBlocker static handler. Forge's Mode$ MinMaxBlocker is
// the static for "this creature must be blocked by exactly N creatures if
// able" / "this creature can only be blocked by N or more creatures"
// (Coalition Honor Guard, True Conviction, Tromokratis-shape). The
// restriction carries a {min, max} payload and a ValidAttacker$ filter.
//
// Routing: cantMustMay static, restriction kind = minMaxBlocker. The
// payload field on Restriction holds { min, max }; consumers cast.
//
// Wave 50 MVP — registration + describe() shape. Plumbing block-count
// enforcement against an active combat declaration is `// TODO(advanced)`
// for the combat-handler block-restriction layer; the current
// validateBlockDeclarations sweep already handles menace's 2+ minimum,
// and cards needing arbitrary min/max are not in the SP3 flagship corpus.
import type { EntityId, ParamValue, StaticAbility, StaticAst } from "@mtg-forge-ts/core";
import type { Restriction } from "../../statics/cant-must-may.js";
import {
  StaticHandler,
  type StaticHandlerCtx,
  normalizeActiveInZones,
  staticHandlerRegistry,
} from "../static-handler.js";
import { buildCardIdPredicate, literalRaw } from "./restriction-helpers.js";

export interface MinMaxBlockerPayload {
  readonly min: number;
  readonly max: number;
}

const parseInt0 = (raw: string | undefined): number => {
  if (raw === undefined) return 0;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : 0;
};

export class MinMaxBlockerStaticHandler extends StaticHandler {
  static override readonly mode = "MinMaxBlocker" as const;

  override build(ast: StaticAst, ctx: StaticHandlerCtx): StaticAbility {
    const params: Readonly<Record<string, ParamValue>> = ast.params;
    const validRaw = literalRaw(params.ValidCard) ?? literalRaw(params.ValidAttacker) ?? "Card.Self";
    const pred = buildCardIdPredicate(validRaw, ctx.sourceCardId, ctx.controllerSeat);
    const min = parseInt0(literalRaw(params.Min));
    // Forge default: max == 0 means "no upper limit"; record as +Infinity
    // for downstream comparators. Numeric Max stays as-is.
    const maxRaw = literalRaw(params.Max);
    const max = maxRaw === undefined ? Number.POSITIVE_INFINITY : parseInt0(maxRaw);

    const payload: MinMaxBlockerPayload = { min, max };
    const restriction: Restriction = {
      sourceStaticId: ctx.staticId,
      kind: "minMaxBlocker",
      subjectFilter: (id, game) => pred(id as EntityId, game),
      payload,
    };

    const activeInZones = normalizeActiveInZones(ast.activeInZones);
    return {
      id: ctx.staticId,
      kind: "static",
      sourceCardId: ctx.sourceCardId,
      activeInZones,
      timestamp: ctx.game.newEntityId(),
      controllerSeatAtReg: ctx.controllerSeat,
      category: "cantMustMay",
      mode: "MinMaxBlocker",
      describe: () => restriction,
    };
  }
}

staticHandlerRegistry.register(MinMaxBlockerStaticHandler);
