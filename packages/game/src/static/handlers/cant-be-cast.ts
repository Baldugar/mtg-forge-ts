// SPDX-License-Identifier: GPL-3.0-or-later
// Wave 50 — CantBeCast static handler. Meddling Mage / Conqueror's Flail —
// "<spell> can't be cast" emblems. The static reads ValidCard$ (the spell
// being cast) and Caster$ (the player attempting to cast); when both
// match, the cast is illegal.
//
// Routing: cantMustMay static, restriction kind = cantCast. The
// legal-action-enumerator already calls isRestricted(game, "cantCast",
// cardId) when proposing castSpell actions; the new handler joins that
// sweep automatically.
//
// MVP scope: Caster$ is gated through the simple You/Opponent/Any
// predicate (sufficient for Conqueror's Flail's "your opponents can't
// cast" + Meddling Mage's "no one can cast the named card"). Subject is
// the spell card id; auxFilter carries the caster predicate so combined
// checks can reject early.
import type { EntityId, ParamValue, PlayerSeat, StaticAbility, StaticAst } from "@mtg-forge-ts/core";
import type { Restriction } from "../../statics/cant-must-may.js";
import {
  StaticHandler,
  type StaticHandlerCtx,
  normalizeActiveInZones,
  staticHandlerRegistry,
} from "../static-handler.js";
import { buildCardIdPredicate, buildPlayerPredicate, literalRaw } from "./restriction-helpers.js";

export class CantBeCastStaticHandler extends StaticHandler {
  static override readonly mode = "CantBeCast" as const;

  override build(ast: StaticAst, ctx: StaticHandlerCtx): StaticAbility {
    const params: Readonly<Record<string, ParamValue>> = ast.params;
    const validRaw = literalRaw(params.ValidCard) ?? "Card";
    const casterRaw = literalRaw(params.Caster) ?? literalRaw(params.ValidActivator);

    const cardPred = buildCardIdPredicate(validRaw, ctx.sourceCardId, ctx.controllerSeat);
    const seatPred = buildPlayerPredicate(casterRaw, ctx.controllerSeat);

    const restriction: Restriction = {
      sourceStaticId: ctx.staticId,
      kind: "cantCast",
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
      category: "cantMustMay",
      mode: "CantBeCast",
      describe: () => restriction,
    };
  }
}

staticHandlerRegistry.register(CantBeCastStaticHandler);
