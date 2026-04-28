// SPDX-License-Identifier: GPL-3.0-or-later
// Wave 60 — CantRegenerate static handler. Eldrazi Conscription / Kaervek
// the Spiteful / deathtouch-synergy emblems — "{ValidCard} can't be
// regenerated". Forge mode name `CantRegenerate`; in plain English the
// effect is "this creature can't be regenerated".
//
// DSL:
//   S:Mode$ CantRegenerate | ValidCard$ Creature.OppCtrl | Description$ ...
//
// Routing: replacementGenerating category — the regen-shield grant in
// RegenerateEffect.resolve consults `canBeRegenerated` before stamping
// the shield. When any active CantRegenerate static matches the target
// creature, the shield is silently not granted (matching Forge: the
// effect simply does nothing; no replacement attaches).
//
// Subject conventions:
//   - ValidCard$ Card.Self       → cardId === sourceCardId
//   - ValidCard$ <type/subtype>  → cardMatchesFilter (Wave 32 grammar)
//   - empty / undefined          → matches every card (per the helper)
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

// Payload extends the replacementGen envelope (mandatory for the
// replacementGenerating category contract). `replacements` is empty —
// the gate is enforced at the regen-shield grant site (RegenerateEffect)
// rather than via a derived replacement entry. This matches Forge: the
// shield simply doesn't form, and no replacement is registered.
export interface CantRegeneratePayload extends ReplacementGenPayload {
  readonly cardMatches: (cardId: EntityId, game: Game) => boolean;
}

export class CantRegenerateStaticHandler extends StaticHandler {
  static override readonly mode = "CantRegenerate" as const;

  override build(ast: StaticAst, ctx: StaticHandlerCtx): StaticAbility {
    const params: Readonly<Record<string, ParamValue>> = ast.params;
    const validCardRaw = literalRaw(params.ValidCard) ?? "Card";
    const cardPred = buildCardIdPredicate(validCardRaw, ctx.sourceCardId, ctx.controllerSeat);

    const payload: CantRegeneratePayload = {
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
      mode: "CantRegenerate",
      describe: () => payload,
    };
  }
}

staticHandlerRegistry.register(CantRegenerateStaticHandler);
