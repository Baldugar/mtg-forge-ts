// SPDX-License-Identifier: GPL-3.0-or-later
// Wave 75 — CantExile static handler. CR 406 — exile prevention.
// Forge's StaticAbilityCantExile.java equivalent.
//
// Forge cards using this:
//   - The Master, Multiplied (DOC) — "Triggered abilities you control
//                                       can't cause you to sacrifice
//                                       or exile creature tokens you
//                                       control." (paired with the
//                                       sibling CantSacrifice mode;
//                                       this static is Secondary$ True
//                                       to share the rules text)
//
// DSL (corpus):
//   S:Mode$ CantExile | ValidCard$ Creature.YouCtrl+token
//          | ValidCause$ Triggered.YouCtrl | ForCost$ False
//          | Secondary$ True | Description$ ...
//
// What it does (Forge): consulted at GameAction.moveTo when the
// destination zone is Exile. When ValidCard$ matches the card being
// moved, the move is rejected silently — no zone change, no
// CardChangedZone event for the Exile transition. Mirrors the Wave
// 70.O CantPhaseIn / Wave 74 CantDiscard silent-rejection pattern.
//
// Routing: replacementGenerating per MODE_TO_CATEGORY. The
// replacements list is empty; the gate is enforced at the moveTo
// call site rather than via a derived replacement chain.
//
// MVP scope:
//   - ValidCard$ <filter> via buildCardIdPredicate (Card.Self,
//     Card.IsRemembered, Wave 50/32 grammar including
//     Creature.YouCtrl+token).
//   - "exile destination rejected for matched card" is the durable
//     contract.
// TODO(advanced):
//   - ValidCause$ Triggered.YouCtrl   — only block exiles CAUSED by
//                                         opponent-controlled (or self-
//                                         triggered) effects. The
//                                         Master, Multiplied's full
//                                         fidelity needs the cause-
//                                         source-controller threading.
//   - ForCost$ True/False             — distinguishes cost-driven
//                                         exile from effect-driven
//                                         exile. MVP gates the
//                                         effect path uniformly.
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

export interface CantExilePayload extends ReplacementGenPayload {
  readonly cardMatches: (cardId: EntityId, game: Game) => boolean;
}

export class CantExileStaticHandler extends StaticHandler {
  static override readonly mode = "CantExile" as const;

  override build(ast: StaticAst, ctx: StaticHandlerCtx): StaticAbility {
    const params: Readonly<Record<string, ParamValue>> = ast.params;
    const validCardRaw = literalRaw(params.ValidCard) ?? "Card.Self";
    const pred = buildCardIdPredicate(validCardRaw, ctx.sourceCardId, ctx.controllerSeat);

    const payload: CantExilePayload = {
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
      mode: "CantExile",
      describe: () => payload,
    };
  }
}

staticHandlerRegistry.register(CantExileStaticHandler);
