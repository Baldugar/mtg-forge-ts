// SPDX-License-Identifier: GPL-3.0-or-later
// Wave 50 — CastWithFlash static handler. Vedalken Orrery / Leyline of
// Anticipation — "you may cast non-creature spells / any spell as though
// it had flash". POSITIVE override: when an active CastWithFlash static
// matches the spell's source and (optionally) the casting player's seat,
// the spell is treated as having Flash for timing purposes.
//
// Routing: `ruleChanging` category (canonical mode→category mapping).
// gatherFlashOverrides() in cant-must-may-extras.ts walks every
// CastWithFlash static (via byMode); the canCastAtCurrentTiming check in
// legal-action-enumerator consults that helper. If any matches, instant-
// speed timing applies for that spell.
import type { EntityId, ParamValue, PlayerSeat, StaticAbility, StaticAst } from "@mtg-forge-ts/core";
import type { Restriction } from "../../statics/cant-must-may.js";
import {
  StaticHandler,
  type StaticHandlerCtx,
  normalizeActiveInZones,
  staticHandlerRegistry,
} from "../static-handler.js";
import { buildCardIdPredicate, buildPlayerPredicate, literalRaw } from "./restriction-helpers.js";

export class CastWithFlashStaticHandler extends StaticHandler {
  static override readonly mode = "CastWithFlash" as const;

  override build(ast: StaticAst, ctx: StaticHandlerCtx): StaticAbility {
    const params: Readonly<Record<string, ParamValue>> = ast.params;
    const validRaw = literalRaw(params.ValidCard) ?? "Card.YouCtrl";
    const casterRaw = literalRaw(params.Caster) ?? literalRaw(params.ValidActivator);

    const cardPred = buildCardIdPredicate(validRaw, ctx.sourceCardId, ctx.controllerSeat);
    const seatPred = buildPlayerPredicate(casterRaw, ctx.controllerSeat);

    const restriction: Restriction = {
      sourceStaticId: ctx.staticId,
      kind: "castWithFlash",
      subjectFilter: (id, game) => cardPred(id as EntityId, game),
      auxFilter: (seat) => seatPred(seat as PlayerSeat),
    };

    const activeInZones = normalizeActiveInZones(ast.activeInZones);
    return {
      id: ctx.staticId,
      kind: "static",
      sourceCardId: ctx.sourceCardId,
      activeInZones,
      timestamp: ctx.game.newEntityId(),
      controllerSeatAtReg: ctx.controllerSeat,
      category: "ruleChanging",
      mode: "CastWithFlash",
      describe: () => restriction,
    };
  }
}

staticHandlerRegistry.register(CastWithFlashStaticHandler);
