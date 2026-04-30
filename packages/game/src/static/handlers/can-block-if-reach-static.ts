// SPDX-License-Identifier: GPL-3.0-or-later
// Wave 70.P — CanBlockIfReach static handler. CR 702.9 / 702.17 —
// flying / reach interaction.
//
// Forge cards using this shape (~1 card in corpus):
//   - Dragon Hunter ("CARDNAME can block Dragons as though it had reach.")
//
// DSL (corpus):
//   S:Mode$ CanBlockIfReach | ValidAttacker$ <filter>
//                           | ValidBlocker$  <filter>
//                           | Description$ ...
//
// What it does (Forge): consulted at the flying-block check. The
// matched ValidBlocker can block the matched ValidAttacker even if
// the attacker has flying and the blocker has neither flying nor
// reach. Mirrors Wave 70.F's IgnoreLandwalk shape but on the
// flying-keyword side.
//
// Routing: cantMustMay per MODE_TO_CATEGORY. Pure action filter
// consulted by block validation; mirrors Wave 50/70.F gate pattern:
// walk the registry per-query at the decision site.
//
// MVP scope:
//   - ValidBlocker$  <filter> — Wave 32 grammar via cardMatchesFilter.
//                                Defaults to "Card.Self" — the source
//                                card is the blocker (Dragon Hunter
//                                shape).
//   - ValidAttacker$ <filter> — Wave 32 grammar; defaults to "Card"
//                                (any attacker — relax flying for the
//                                gated blocker against any attacker).
import type { EntityId, ParamValue, StaticAbility, StaticAst } from "@mtg-forge-ts/core";
import type { Game } from "../../game.js";
import {
  StaticHandler,
  type StaticHandlerCtx,
  normalizeActiveInZones,
  staticHandlerRegistry,
} from "../static-handler.js";
import { buildCardIdPredicate, literalRaw } from "./restriction-helpers.js";

export interface CanBlockIfReachPayload {
  readonly kind: "canBlockIfReach";
  readonly blockerMatches: (cardId: EntityId, game: Game) => boolean;
  readonly attackerMatches: (cardId: EntityId, game: Game) => boolean;
}

export class CanBlockIfReachStaticHandler extends StaticHandler {
  static override readonly mode = "CanBlockIfReach" as const;

  override build(ast: StaticAst, ctx: StaticHandlerCtx): StaticAbility {
    const params: Readonly<Record<string, ParamValue>> = ast.params;
    const validBlockerRaw = literalRaw(params.ValidBlocker) ?? "Card.Self";
    const validAttackerRaw = literalRaw(params.ValidAttacker);
    const blockerPred = buildCardIdPredicate(validBlockerRaw, ctx.sourceCardId, ctx.controllerSeat);
    const attackerPred = buildCardIdPredicate(validAttackerRaw, ctx.sourceCardId, ctx.controllerSeat);

    const payload: CanBlockIfReachPayload = {
      kind: "canBlockIfReach",
      blockerMatches: (cardId, game) => blockerPred(cardId, game),
      attackerMatches: (cardId, game) => attackerPred(cardId, game),
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
      mode: "CanBlockIfReach",
      describe: () => payload,
    };
  }
}

staticHandlerRegistry.register(CanBlockIfReachStaticHandler);
