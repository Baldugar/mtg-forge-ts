// SPDX-License-Identifier: GPL-3.0-or-later
// Wave 60.H — CantTransform static handler. CR 701.32 — "X can't
// transform". Forge cards using this:
//   - Immerwolf (Non-Human Werewolves you control can't transform)
//   - Day/Night interaction disruptors (rare)
//
// DSL:
//   S:Mode$ CantTransform | ValidCard$ Creature.Werewolf+nonHuman+YouCtrl | Description$ ...
//
// What it does (Forge): the matched cards can't transform. The
// transform call site (GameAction.transform → multiface/transform.ts)
// consults `canTransform(game, cardId)` before toggling the face; on a
// match the action no-ops silently (no Transformed event, no face
// change, no layer-epoch bump). Mirrors Forge's silent-skip semantics
// for static transform-prevention effects.
//
// Routing: replacementGenerating category — matches the rest of the
// Cant* family in MODE_TO_CATEGORY. The replacements list is empty;
// the gate is enforced at the transform call site rather than via a
// derived replacement chain.
//
// MVP scope:
//   - ValidCard$ <filter> — Wave 32 grammar via cardMatchesFilter.
//   - Card.Self short-circuit honored (sourceCardId === cardId).
// Wave 109 — closes the prior TODO(advanced) tail. No Forge corpus card
// uses a side-discriminator sub-filter on a CantTransform static; the
// Day/Night pairs that Forge ships rely on the transform-call site to
// pick the side, not on the static to limit prevention to one
// direction. The ValidCard$ predicate is the durable contract.
import type { EntityId, ParamValue, ReplacementAbility, StaticAbility, StaticAst } from "@mtg-forge-ts/core";
import type { Game } from "../../game.js";
import type { ReplacementGenPayload } from "../../statics/replacement-generating.js";
import {
  StaticHandler,
  type StaticHandlerCtx,
  normalizeActiveInZones,
  staticHandlerRegistry,
} from "../static-handler.js";
import { buildCardIdPredicate, literalRaw } from "./restriction-helpers.js";

export interface CantTransformPayload extends ReplacementGenPayload {
  readonly cardMatches: (cardId: EntityId, game: Game) => boolean;
}

export class CantTransformStaticHandler extends StaticHandler {
  static override readonly mode = "CantTransform" as const;

  override build(ast: StaticAst, ctx: StaticHandlerCtx): StaticAbility {
    const params: Readonly<Record<string, ParamValue>> = ast.params;
    const validCardRaw = literalRaw(params.ValidCard) ?? "Card";
    const cardPred = buildCardIdPredicate(validCardRaw, ctx.sourceCardId, ctx.controllerSeat);

    const payload: CantTransformPayload = {
      kind: "replacementGen",
      replacements: [] as readonly ReplacementAbility[],
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
      category: "replacementGenerating",
      mode: "CantTransform",
      describe: () => payload,
    };
  }
}

staticHandlerRegistry.register(CantTransformStaticHandler);
