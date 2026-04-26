// SPDX-License-Identifier: GPL-3.0-or-later
// Wave 50 — Panharmonicon static handler. Forge's `S:Mode$ Panharmonicon`
// is the trigger-doubler family (Panharmonicon, Mondrak, Glory Dominus,
// Yarok). The static reads ValidCard$ (the permanent whose triggers
// double) and ValidEvent$ (the trigger event kind to multiply, e.g.
// "EntersBattlefield"). When active, qualifying triggered abilities fire
// N+1 times rather than once.
//
// Routing: `ruleChanging` category (canonical mode→category map). The
// trigger registry's scheduling layer would consult
// gatherTriggerMultipliers(game, sourceCardId, eventKind) to compute the
// fire count.
//
// Wave 50 MVP — registration only. The describe() payload carries the
// ValidCard$/ValidEvent$ filters and the multiplier (default 2 — fires
// "an additional time"). Wiring trigger-fire-count into the trigger
// scheduler is `// TODO(advanced)` — the SP3 trigger-stack scheduler
// resolves each TriggerAst once per event; the multiplier hook needs a
// new fire-count pass that this static makes possible but doesn't
// install. Cards using Panharmonicon-static won't crash; their triggers
// just fire the default once until the scheduler hook lands.
import type { EntityId, ParamValue, StaticAbility, StaticAst } from "@mtg-forge-ts/core";
import {
  StaticHandler,
  type StaticHandlerCtx,
  normalizeActiveInZones,
  staticHandlerRegistry,
} from "../static-handler.js";
import { buildCardIdPredicate, literalRaw } from "./restriction-helpers.js";

export interface PanharmoniconPayload {
  readonly kind: "panharmonicon";
  readonly sourceStaticId: EntityId;
  /** Trigger source filter — Panharmonicon: "artifact and creature you control". */
  readonly cardMatches: (cardId: EntityId, game: import("../../game.js").Game) => boolean;
  /** Trigger event kind filter — Panharmonicon: "EntersBattlefield". */
  readonly validEventKind: string | undefined;
  /** Number of additional fires (default 1 — "fires an additional time"). */
  readonly additionalFires: number;
}

const parseInt0 = (raw: string | undefined): number => {
  if (raw === undefined) return 0;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : 0;
};

export class PanharmoniconStaticHandler extends StaticHandler {
  static override readonly mode = "Panharmonicon" as const;

  override build(ast: StaticAst, ctx: StaticHandlerCtx): StaticAbility {
    const params: Readonly<Record<string, ParamValue>> = ast.params;
    const validCardRaw = literalRaw(params.ValidCard) ?? "Card.YouCtrl";
    const validEventRaw = literalRaw(params.ValidEvent) ?? literalRaw(params.ValidMode);
    // Forge default for the bare Panharmonicon static is "fire one extra
    // time"; Mondrak / Yarok use the same shape; cards that fire MORE than
    // one extra time pin Amount$ (Hosit Hat-Maker for example).
    const additionalFires = Math.max(1, parseInt0(literalRaw(params.Amount)) || 1);

    const cardPred = buildCardIdPredicate(validCardRaw, ctx.sourceCardId, ctx.controllerSeat);

    const payload: PanharmoniconPayload = {
      kind: "panharmonicon",
      sourceStaticId: ctx.staticId,
      cardMatches: cardPred,
      validEventKind: validEventRaw,
      additionalFires,
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
      mode: "Panharmonicon",
      describe: () => payload,
    };
  }
}

staticHandlerRegistry.register(PanharmoniconStaticHandler);
