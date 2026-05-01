// SPDX-License-Identifier: GPL-3.0-or-later
// Wave 60.C — MayBeCastBy static handler. Positive cast-permission gate
// (CR 601). The static grants a player permission to cast a card matching
// ValidCard$ even when the normal cast rules wouldn't permit it (zone
// source, hand-only restriction, etc.). Examples:
//
//   S:Mode$ MayBeCastBy | ValidCard$ Card.YouCtrl.TopLibrary | Caster$ You
//     (Bolas's Citadel — cast nonland cards from the top of your library)
//   S:Mode$ MayBeCastBy | ValidCard$ Land.YouCtrl.TopLibrary | Caster$ You
//     (Oracle of Mul Daya — play lands from top of library)
//   S:Mode$ MayBeCastBy | ValidCard$ Card.OppCtrl.InHand | Caster$ You
//     (Sen Triplets — cast cards from target opponent's hand)
//   S:Mode$ MayBeCastBy | ValidCard$ Card | Caster$ Player
//     (Knowledge Pool / Mind's Dilation — anyone may cast the exiled card)
//
// Routing: ruleChanging category (mirrors CastWithFlash, the other
// positive cast-permission gate). The cast pipeline / legal-action
// enumerator consults `mayBeCastBy(game, cardId, casterSeat)` from
// statics/wave60-cast-gates; on a match, the cast is permitted regardless
// of zone-source / hand-only restrictions.
//
// Subject conventions:
//   - ValidCard$ Card.Self / type/subtype filter / undefined → handled
//     by buildCardIdPredicate (Wave 32 grammar).
//   - Caster$ You / Opponent / Any / Player → handled by
//     buildPlayerPredicate (Wave 50 grammar). Falls through to
//     conservative reject for unrecognised tokens.
//
// MVP — the permission gate is the durable contract. Visibility
// plumbing (Bolas's Citadel revealing the topdeck card to its
// controller) is a downstream pipeline concern: when the cast pipeline
// asks "what cards can this player cast?", it should iterate the
// MayBeCastBy-permitted set. Wave 99 closure — the legal-action
// enumerator now iterates the seat's hand AND every other seat's hand
// (Sen Triplets shape) AND library-top / Exile, all gated through
// mayBeCastBy. The remaining surface (graveyard / face-down exile)
// lands as cards demand it.
import type { EntityId, ParamValue, PlayerSeat, StaticAbility, StaticAst } from "@mtg-forge-ts/core";
import type { Game } from "../../game.js";
import {
  StaticHandler,
  type StaticHandlerCtx,
  normalizeActiveInZones,
  staticHandlerRegistry,
} from "../static-handler.js";
import { buildCardIdPredicate, buildPlayerPredicate, literalRaw } from "./restriction-helpers.js";

// Payload — the gate consumer (mayBeCastBy helper) reads both predicates
// per static entry. `cardMatches` resolves against the candidate spell
// being cast; `casterMatches` resolves against the seat attempting the
// cast. Both must hit for the permission to be granted.
export interface MayBeCastByPayload {
  readonly kind: "mayBeCastBy";
  readonly cardMatches: (cardId: EntityId, game: Game) => boolean;
  readonly casterMatches: (seat: PlayerSeat) => boolean;
}

export class MayBeCastByStaticHandler extends StaticHandler {
  static override readonly mode = "MayBeCastBy" as const;

  override build(ast: StaticAst, ctx: StaticHandlerCtx): StaticAbility {
    const params: Readonly<Record<string, ParamValue>> = ast.params;
    const validRaw = literalRaw(params.ValidCard) ?? "Card";
    const casterRaw = literalRaw(params.Caster) ?? literalRaw(params.ValidActivator);

    const cardPred = buildCardIdPredicate(validRaw, ctx.sourceCardId, ctx.controllerSeat);
    const seatPred = buildPlayerPredicate(casterRaw, ctx.controllerSeat);

    const payload: MayBeCastByPayload = {
      kind: "mayBeCastBy",
      cardMatches: (cardId, game) => cardPred(cardId, game),
      casterMatches: (seat) => seatPred(seat),
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
      mode: "MayBeCastBy",
      describe: () => payload,
    };
  }
}

staticHandlerRegistry.register(MayBeCastByStaticHandler);
