// SPDX-License-Identifier: GPL-3.0-or-later
// Wave 70.F — UntapOtherPlayer static handler. CR 502 — additional untap
// during another player's untap step. Forge cards using this:
//   - Awakening                 (every player untaps lands during each
//                                untap step)
//   - Vedalken Orrery analogues (your permanents untap during opponents'
//                                untap steps as well)
//   - Dramatic Reversal-style emblems
//
// DSL:
//   S:Mode$ UntapOtherPlayer | ValidCard$ <filter>
//                            | ValidPlayer$ <filter>
//                            | Description$ ...
//
// What it does (Forge): during the untap step of the matched ValidPlayer,
// every battlefield card that matches ValidCard$ untaps as part of that
// step (in addition to the active player's normal untap). Forge's
// StaticAbilityUntapOtherPlayer.untap(card, player) is a "should this
// card untap during this player's untap step?" boolean — true iff some
// active static matches both the card and the player whose step it is.
//
// Routing: ruleChanging category — already mapped in MODE_TO_CATEGORY.
// The describe() payload exposes both predicates; the gate consumer
// (shouldUntapDuringStep in wave70f-combat-gates.ts) walks the registry
// per-query.
//
// MVP scope:
//   - ValidCard$ <filter> — Wave 32 grammar via cardMatchesFilter.
//   - ValidPlayer$ — Wave 50 buildPlayerPredicate grammar (You /
//     Opponent / Any / Player). Empty / undefined → match every player.
// TODO(advanced):
//   - Optional$ True (some shapes give the controlling player the
//     choice to untap each card individually).
import type { EntityId, ParamValue, PlayerSeat, StaticAbility, StaticAst } from "@mtg-forge-ts/core";
import type { Game } from "../../game.js";
import {
  StaticHandler,
  type StaticHandlerCtx,
  normalizeActiveInZones,
  staticHandlerRegistry,
} from "../static-handler.js";
import { buildCardIdPredicate, buildPlayerPredicate, literalRaw } from "./restriction-helpers.js";

export interface UntapOtherPlayerPayload {
  readonly kind: "untapOtherPlayer";
  readonly cardMatches: (cardId: EntityId, game: Game) => boolean;
  readonly playerMatches: (seat: PlayerSeat) => boolean;
}

export class UntapOtherPlayerStaticHandler extends StaticHandler {
  static override readonly mode = "UntapOtherPlayer" as const;

  override build(ast: StaticAst, ctx: StaticHandlerCtx): StaticAbility {
    const params: Readonly<Record<string, ParamValue>> = ast.params;
    const validCardRaw = literalRaw(params.ValidCard);
    const validPlayerRaw = literalRaw(params.ValidPlayer);
    const cardPred = buildCardIdPredicate(validCardRaw, ctx.sourceCardId, ctx.controllerSeat);
    const seatPred = buildPlayerPredicate(validPlayerRaw, ctx.controllerSeat);

    const payload: UntapOtherPlayerPayload = {
      kind: "untapOtherPlayer",
      cardMatches: (cardId, game) => cardPred(cardId, game),
      playerMatches: (seat) => seatPred(seat),
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
      mode: "UntapOtherPlayer",
      describe: () => payload,
    };
  }
}

staticHandlerRegistry.register(UntapOtherPlayerStaticHandler);
