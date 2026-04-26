// SPDX-License-Identifier: GPL-3.0-or-later
// Wave 50 — CanAttackDefender static handler. POSITIVE override: creatures
// matching ValidCard$ may attack as if they didn't have defender (Sylvan
// Advocate-shape, "you may attack with creatures with defender" emblems).
//
// Routing: cantMustMay static, restriction kind = canAttackDefender. Combat
// attack legality calls a positive helper canAttackAsIfNoDefender(game,
// attackerId) that walks every canAttackDefender static; if any matches
// the attacker, the defender keyword is ignored for legality.
import type { EntityId, ParamValue, StaticAbility, StaticAst } from "@mtg-forge-ts/core";
import type { Restriction } from "../../statics/cant-must-may.js";
import {
  StaticHandler,
  type StaticHandlerCtx,
  normalizeActiveInZones,
  staticHandlerRegistry,
} from "../static-handler.js";
import { buildCardIdPredicate, literalRaw } from "./restriction-helpers.js";

export class CanAttackDefenderStaticHandler extends StaticHandler {
  static override readonly mode = "CanAttackDefender" as const;

  override build(ast: StaticAst, ctx: StaticHandlerCtx): StaticAbility {
    const params: Readonly<Record<string, ParamValue>> = ast.params;
    const validRaw = literalRaw(params.ValidCard) ?? "Card.Self";
    const pred = buildCardIdPredicate(validRaw, ctx.sourceCardId, ctx.controllerSeat);

    const restriction: Restriction = {
      sourceStaticId: ctx.staticId,
      kind: "canAttackDefender",
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
      mode: "CanAttackDefender",
      describe: () => restriction,
    };
  }
}

staticHandlerRegistry.register(CanAttackDefenderStaticHandler);
