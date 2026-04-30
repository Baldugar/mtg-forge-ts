// SPDX-License-Identifier: GPL-3.0-or-later
// Wave 70.I — NumLoyaltyAct static handler. CR 606.5 — overrides the
// once-per-turn limit on a planeswalker's loyalty abilities.
//
// Forge cards using this:
//   - Carth the Lion              (your planeswalkers' loyalty abilities
//                                   you've activated this turn count as
//                                   though they hadn't been activated this
//                                   turn — effectively +1 activation per
//                                   planeswalker per turn)
//   - The Chain Veil              (each planeswalker you control may be
//                                   activated one additional time this
//                                   turn)
//   - Oath of Teferi              (each planeswalker you control may have
//                                   one additional loyalty ability
//                                   activated each turn)
//   - Power Cosm-style emblems    (assorted +1 activations effects)
//   - Tezzeret, Master of Metal   (its +1 alts adjusts via NumLoyaltyAct
//                                   when in CCD form; the static form
//                                   surfaces the same hook)
//
// DSL:
//   S:Mode$ NumLoyaltyAct | ValidCard$ Card.Self        | NumActivations$ N
//   S:Mode$ NumLoyaltyAct | ValidCard$ Planeswalker.YouCtrl | NumActivations$ 1
//
// What it does (Forge): overrides the canonical "no more than one of a
// planeswalker's loyalty abilities can be activated each turn" cap. The
// default cap is 1 (CR 606.5b). Each active NumLoyaltyAct static matching
// the planeswalker contributes its NumActivations$ delta; the effective
// cap is `1 + sum_of_matching_NumActivations`. The activate-time gate
// then checks `loyaltyActivationsThisTurn(card) < effectiveCap` and
// rejects (no cost paid, no stack push) when at the cap.
//
// Routing: ruleChanging category — already mapped in MODE_TO_CATEGORY.
// The gate consumer (effectiveMaxLoyaltyActivations in
// wave70i-loyalty-gates.ts) walks the registry per-query.
//
// MVP scope:
//   - ValidCard$ <filter> — Wave 32 grammar via cardMatchesFilter.
//   - NumActivations$ N — non-negative integer literal; defaults to 1
//     when the param is omitted (matches Forge's default for the
//     Carth-shape "+1 activation" stamp).
// TODO(advanced):
//   - Conditional sub-params (e.g. only when the planeswalker has
//     starting loyalty >= K, or only on the controlling player's turn).
import type { EntityId, ParamValue, StaticAbility, StaticAst } from "@mtg-forge-ts/core";
import type { Game } from "../../game.js";
import {
  StaticHandler,
  type StaticHandlerCtx,
  normalizeActiveInZones,
  staticHandlerRegistry,
} from "../static-handler.js";
import { buildCardIdPredicate, literalRaw } from "./restriction-helpers.js";

export interface NumLoyaltyActPayload {
  readonly kind: "numLoyaltyAct";
  readonly cardMatches: (cardId: EntityId, game: Game) => boolean;
  readonly numActivations: number;
}

const parseNumActivations = (raw: string | undefined): number => {
  if (raw === undefined || raw.length === 0) return 1;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n >= 0 ? n : 1;
};

export class NumLoyaltyActStaticHandler extends StaticHandler {
  static override readonly mode = "NumLoyaltyAct" as const;

  override build(ast: StaticAst, ctx: StaticHandlerCtx): StaticAbility {
    const params: Readonly<Record<string, ParamValue>> = ast.params;
    const validCardRaw = literalRaw(params.ValidCard);
    const numActivationsRaw = literalRaw(params.NumActivations);
    const cardPred = buildCardIdPredicate(validCardRaw, ctx.sourceCardId, ctx.controllerSeat);
    const numActivations = parseNumActivations(numActivationsRaw);

    const payload: NumLoyaltyActPayload = {
      kind: "numLoyaltyAct",
      cardMatches: (cardId, game) => cardPred(cardId, game),
      numActivations,
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
      mode: "NumLoyaltyAct",
      describe: () => payload,
    };
  }
}

staticHandlerRegistry.register(NumLoyaltyActStaticHandler);
