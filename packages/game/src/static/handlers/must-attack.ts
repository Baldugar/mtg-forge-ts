// SPDX-License-Identifier: GPL-3.0-or-later
// Wave 50 — MustAttack static handler. The static-modeled cousin of
// goad / "must attack each combat if able" emblems (CR 506.5 — attack
// requirements). MVP scope: register the restriction and stamp a runtime
// `mustAttack` flag onto the affected card so the SP3 attack-step UI can
// surface the requirement; combat-handler attack legality consults the
// static-side restriction directly via gatherRestrictions("mustAttack").
//
// Routing: cantMustMay static, restriction kind = mustAttack.
import type { EntityId, ParamValue, StaticAbility, StaticAst } from "@mtg-forge-ts/core";
import type { Restriction } from "../../statics/cant-must-may.js";
import {
  StaticHandler,
  type StaticHandlerCtx,
  normalizeActiveInZones,
  staticHandlerRegistry,
} from "../static-handler.js";
import { buildCardIdPredicate, literalRaw } from "./restriction-helpers.js";

export class MustAttackStaticHandler extends StaticHandler {
  static override readonly mode = "MustAttack" as const;

  override build(ast: StaticAst, ctx: StaticHandlerCtx): StaticAbility {
    const params: Readonly<Record<string, ParamValue>> = ast.params;
    const validRaw = literalRaw(params.ValidCard) ?? "Card.Self";
    const pred = buildCardIdPredicate(validRaw, ctx.sourceCardId, ctx.controllerSeat);

    const restriction: Restriction = {
      sourceStaticId: ctx.staticId,
      kind: "mustAttack",
      subjectFilter: (id, game) => pred(id as EntityId, game),
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
      mode: "MustAttack",
      describe: () => restriction,
    };
  }
}

staticHandlerRegistry.register(MustAttackStaticHandler);
