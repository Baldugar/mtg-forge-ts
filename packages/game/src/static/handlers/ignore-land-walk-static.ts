// SPDX-License-Identifier: GPL-3.0-or-later
// Wave 70.F — IgnoreLandwalk static handler. CR 702.13 — landwalk
// override. Forge cards using this:
//   - Sphere of Truth / Reverence (analogues — block landwalkers)
//   - Suppression Field analogues (some printings disable landwalk
//                                   targeting via this static)
//
// Note: the StaticAbilityMode enum entry (Forge-faithful) is spelled
// "IgnoreLandwalk" with lowercase 'w' (matches Forge's Java enum).
//
// DSL:
//   S:Mode$ IgnoreLandwalk | ValidBlocker$ <filter>
//                          | ValidAttacker$ <filter>
//                          | Description$ ...
//
// What it does (Forge): the matched ValidBlocker can block the matched
// ValidAttacker even if the attacker has a landwalk keyword that would
// normally make the block illegal. The block-restrictions module's
// landwalk loop consults this gate before rejecting the block:
// `ignoresLandWalk(game, blockerId, attackerId)` returning true short-
// circuits the rejection for that pairing.
//
// Routing: ruleChanging category — already mapped in MODE_TO_CATEGORY.
// Pure rule override consulted by block validation. Mirrors the Wave
// 60.A / 60.H / 70.D / 70.E gate pattern: walk the registry per-query.
//
// MVP scope:
//   - ValidBlocker$ <filter> — Wave 32 grammar via cardMatchesFilter.
//   - ValidAttacker$ <filter> — same grammar; defaults to "Card" (any).
// TODO(advanced):
//   - ValidKeyword$ <filter> (Forge supports per-keyword-instance
//     filtering, e.g. "only ignore islandwalk"). MVP ignores all
//     landwalks uniformly when the gate matches.
import type { EntityId, ParamValue, StaticAbility, StaticAst } from "@mtg-forge-ts/core";
import type { Game } from "../../game.js";
import {
  StaticHandler,
  type StaticHandlerCtx,
  normalizeActiveInZones,
  staticHandlerRegistry,
} from "../static-handler.js";
import { buildCardIdPredicate, literalRaw } from "./restriction-helpers.js";

export interface IgnoreLandWalkPayload {
  readonly kind: "ignoreLandWalk";
  readonly blockerMatches: (cardId: EntityId, game: Game) => boolean;
  readonly attackerMatches: (cardId: EntityId, game: Game) => boolean;
}

export class IgnoreLandWalkStaticHandler extends StaticHandler {
  static override readonly mode = "IgnoreLandwalk" as const;

  override build(ast: StaticAst, ctx: StaticHandlerCtx): StaticAbility {
    const params: Readonly<Record<string, ParamValue>> = ast.params;
    const validBlockerRaw = literalRaw(params.ValidBlocker) ?? "Card.Self";
    const validAttackerRaw = literalRaw(params.ValidAttacker);
    const blockerPred = buildCardIdPredicate(validBlockerRaw, ctx.sourceCardId, ctx.controllerSeat);
    const attackerPred = buildCardIdPredicate(validAttackerRaw, ctx.sourceCardId, ctx.controllerSeat);

    const payload: IgnoreLandWalkPayload = {
      kind: "ignoreLandWalk",
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
      category: "ruleChanging",
      mode: "IgnoreLandwalk",
      describe: () => payload,
    };
  }
}

staticHandlerRegistry.register(IgnoreLandWalkStaticHandler);
