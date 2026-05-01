// SPDX-License-Identifier: GPL-3.0-or-later
// Wave 78 — BlockTapped static handler. CR 509.1a (block legality) +
// Forge's StaticAbilityBlockTapped.java equivalent.
//
// Forge cards using this shape (~few cards in the corpus):
//   - Masako the Humorless ("Tapped creatures you control can block as
//                            though they were untapped.")
//
// DSL (corpus):
//   S:Mode$ BlockTapped | ValidCard$ Creature.tapped+YouCtrl
//                       | Description$ ...
//
// What it does (Forge): consulted by the block-legality validator at
// declareBlockers time. CR 509.1a normally rejects blockers that are
// already tapped — when an active BlockTapped static matches the
// declared blocker, the tapped-rejection is suppressed and the block
// is allowed to stand even though the creature is tapped. Mirrors the
// Wave 70.F IgnoreLandwalk / Wave 70.P CanBlockIfReach shape on the
// tap-state side.
//
// Routing: cantMustMay per MODE_TO_CATEGORY. Pure action filter
// consulted by block validation; mirrors Wave 50/70.F gate pattern:
// walk the registry per-query at the decision site.
//
// MVP scope:
//   - ValidCard$ <filter>     — Wave 32 grammar via cardMatchesFilter.
//                                Defaults to "Card.Self" — the source
//                                card itself is the bypassing blocker
//                                (never observed; canonical Forge cards
//                                use Creature.tapped+YouCtrl shape).
import type { EntityId, ParamValue, StaticAbility, StaticAst } from "@mtg-forge-ts/core";
import type { Game } from "../../game.js";
import {
  StaticHandler,
  type StaticHandlerCtx,
  normalizeActiveInZones,
  staticHandlerRegistry,
} from "../static-handler.js";
import { buildCardIdPredicate, literalRaw } from "./restriction-helpers.js";

export interface BlockTappedPayload {
  readonly kind: "blockTapped";
  readonly cardMatches: (cardId: EntityId, game: Game) => boolean;
}

export class BlockTappedStaticHandler extends StaticHandler {
  static override readonly mode = "BlockTapped" as const;

  override build(ast: StaticAst, ctx: StaticHandlerCtx): StaticAbility {
    const params: Readonly<Record<string, ParamValue>> = ast.params;
    const validCardRaw = literalRaw(params.ValidCard) ?? "Card.Self";
    const cardPred = buildCardIdPredicate(validCardRaw, ctx.sourceCardId, ctx.controllerSeat);

    const payload: BlockTappedPayload = {
      kind: "blockTapped",
      cardMatches: (cardId, game) => cardPred(cardId, game),
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
      mode: "BlockTapped",
      describe: () => payload,
    };
  }
}

staticHandlerRegistry.register(BlockTappedStaticHandler);
