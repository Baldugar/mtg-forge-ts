// SPDX-License-Identifier: GPL-3.0-or-later
// Wave 70.O — CantPhaseOut static handler. CR 702.26 — phasing.
//
// Forge cards using this shape (~2 cards in corpus): cards that
// prevent matched permanents from phasing out — anti-phasing
// guardrails, hexproof-against-phasing emblems.
//
// DSL:
//   S:Mode$ CantPhaseOut | ValidCard$ <filter> | Description$ ...
//
// What it does (Forge): consulted at the phaseOut primitive. When
// ValidCard$ matches the card targeted by phaseOut, the transition is
// rejected silently — the card stays phased in, no PhasedOut event is
// emitted. Mirrors Wave 60.H's CantSacrifice / CantTransform shape.
//
// Routing: replacementGenerating per MODE_TO_CATEGORY. The
// replacements list is empty; the gate is enforced at the phaseOut
// call site rather than via a derived replacement chain.
//
// MVP scope: ValidCard$ <filter> via buildCardIdPredicate (Card.Self,
// named filters, Wave 50/32 grammar).
import type { ParamValue, ReplacementAbility, StaticAbility, StaticAst } from "@mtg-forge-ts/core";
import type { ReplacementGenPayload } from "../../statics/replacement-generating.js";
import {
  StaticHandler,
  type StaticHandlerCtx,
  normalizeActiveInZones,
  staticHandlerRegistry,
} from "../static-handler.js";
import { buildCardIdPredicate, literalRaw } from "./restriction-helpers.js";

export interface CantPhaseOutPayload extends ReplacementGenPayload {
  readonly cardMatches: (
    cardId: import("@mtg-forge-ts/core").EntityId,
    game: import("../../game.js").Game,
  ) => boolean;
}

export class CantPhaseOutStaticHandler extends StaticHandler {
  static override readonly mode = "CantPhaseOut" as const;

  override build(ast: StaticAst, ctx: StaticHandlerCtx): StaticAbility {
    const params: Readonly<Record<string, ParamValue>> = ast.params;
    const validCardRaw = literalRaw(params.ValidCard) ?? "Card.Self";
    const pred = buildCardIdPredicate(validCardRaw, ctx.sourceCardId, ctx.controllerSeat);

    const payload: CantPhaseOutPayload = {
      kind: "replacementGen",
      replacements: [] as readonly ReplacementAbility[],
      cardMatches: (cardId, game) => pred(cardId, game),
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
      mode: "CantPhaseOut",
      describe: () => payload,
    };
  }
}

staticHandlerRegistry.register(CantPhaseOutStaticHandler);
