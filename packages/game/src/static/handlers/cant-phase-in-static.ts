// SPDX-License-Identifier: GPL-3.0-or-later
// Wave 70.O — CantPhaseIn static handler. CR 702.26 — phasing.
//
// Forge cards using this shape (~5 cards in corpus): cards that lock a
// permanent in its phased-out state, e.g. Mark of Disasters analogues,
// curses that prevent the phasing pipeline from restoring a permanent
// at the start of its controller's untap step.
//
// DSL:
//   S:Mode$ CantPhaseIn  | ValidCard$ <filter> | Description$ ...
//
// What it does (Forge): consulted at the phaseIn primitive. When
// ValidCard$ matches the card targeted by phaseIn, the transition is
// rejected silently — the card stays phased out, no PhasedIn event is
// emitted. Mirrors Wave 60.H's CantSacrifice / CantTransform shape.
//
// Routing: replacementGenerating per MODE_TO_CATEGORY. The
// replacements list is empty; the gate is enforced at the phaseIn
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

export interface CantPhaseInPayload extends ReplacementGenPayload {
  readonly cardMatches: (
    cardId: import("@mtg-forge-ts/core").EntityId,
    game: import("../../game.js").Game,
  ) => boolean;
}

export class CantPhaseInStaticHandler extends StaticHandler {
  static override readonly mode = "CantPhaseIn" as const;

  override build(ast: StaticAst, ctx: StaticHandlerCtx): StaticAbility {
    const params: Readonly<Record<string, ParamValue>> = ast.params;
    const validCardRaw = literalRaw(params.ValidCard) ?? "Card.Self";
    const pred = buildCardIdPredicate(validCardRaw, ctx.sourceCardId, ctx.controllerSeat);

    const payload: CantPhaseInPayload = {
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
      mode: "CantPhaseIn",
      describe: () => payload,
    };
  }
}

staticHandlerRegistry.register(CantPhaseInStaticHandler);
