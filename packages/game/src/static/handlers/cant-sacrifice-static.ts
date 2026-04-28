// SPDX-License-Identifier: GPL-3.0-or-later
// Wave 60.H — CantSacrifice static handler. CR 701.16 — "X can't be
// sacrificed". Forge cards using this:
//   - Sigarda, Host of Herons (creatures and you can't be sacrificed
//     except by your own choice — the carve-out via CantSacrificeBy$)
//   - Aegis of the Gods analogues
//   - Heroic Intervention's sub-effect (often delivered as a continuous
//     static)
//
// DSL:
//   S:Mode$ CantSacrifice | ValidCard$ Card.YouCtrl | Description$ ...
//   S:Mode$ CantSacrifice | ValidCard$ Card.YouCtrl | ValidCause$ SpellAbility.OppCtrl | ForCost$ False | Description$ ...
//
// What it does (Forge): the matched cards can't be sacrificed. The
// sacrifice call site (GameAction.sacrifice) consults
// `canBeSacrificed(game, cardId)` before constructing the
// SacrificeIntent; on a match the action no-ops silently (no event,
// no zone change). For costs that include a sacrifice clause, the
// cost-pay path consults the same gate and rejects payment when no
// matched permanent can be sacrificed.
//
// Routing: replacementGenerating category — matches the rest of the
// Cant* family in MODE_TO_CATEGORY. The replacements list is empty;
// the gate is enforced at the sacrifice call site rather than via a
// derived replacement chain (mirrors Forge's silent-skip semantics).
//
// MVP scope:
//   - ValidCard$ <filter> — Wave 32 grammar via cardMatchesFilter.
//   - Card.Self short-circuit honored (sourceCardId === cardId).
// TODO(advanced):
//   - CantSacrificeBy$ <player-filter>     — "except by you" carve-out.
//   - ValidCause$ <SpellAbility filter>    — Sigarda's "spells/abilities
//                                            opponents control" sub-clause.
//   - ForCost$ True/False                  — distinguishes cost-driven
//                                            vs. effect-driven sacrifice.
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

export interface CantSacrificePayload extends ReplacementGenPayload {
  readonly cardMatches: (cardId: EntityId, game: Game) => boolean;
}

export class CantSacrificeStaticHandler extends StaticHandler {
  static override readonly mode = "CantSacrifice" as const;

  override build(ast: StaticAst, ctx: StaticHandlerCtx): StaticAbility {
    const params: Readonly<Record<string, ParamValue>> = ast.params;
    const validCardRaw = literalRaw(params.ValidCard) ?? "Card";
    const cardPred = buildCardIdPredicate(validCardRaw, ctx.sourceCardId, ctx.controllerSeat);

    const payload: CantSacrificePayload = {
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
      mode: "CantSacrifice",
      describe: () => payload,
    };
  }
}

staticHandlerRegistry.register(CantSacrificeStaticHandler);
