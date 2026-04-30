// SPDX-License-Identifier: GPL-3.0-or-later
// Wave 70.J — IgnoreLegendRule static handler. CR 704.5j override —
// matched cards are exempt from the legend rule SBA (two or more
// legendary permanents with the same name controlled by the same
// player).
//
// Forge cards using this:
//   - Mirror Gallery                ("The 'legend rule' doesn't apply.")
//   - Brothers Yamazaki             (paired-legendary self-exemption when
//                                     both copies are on the battlefield)
//   - Sliver Legion-shape           ("The 'legend rule' doesn't apply to
//                                     Slivers you control.")
//   - Spider tribal commander       (subtype-scoped exemption)
//   - Token-doppelganger commanders ("The 'legend rule' doesn't apply
//                                     to tokens you control.")
//   - Commander-only exemption      ("The 'legend rule' doesn't apply to
//                                     commanders you control.")
//   - Syr Joshua / Syr Saxon paired exemption
//
// DSL:
//   S:Mode$ IgnoreLegendRule | Description$ ...
//   S:Mode$ IgnoreLegendRule | ValidCard$ Permanent.YouCtrl
//   S:Mode$ IgnoreLegendRule | ValidCard$ Permanent.token+YouCtrl
//   S:Mode$ IgnoreLegendRule | ValidCard$ Sliver.YouCtrl
//   S:Mode$ IgnoreLegendRule | ValidCard$ Permanent.namedBrothers Yamazaki
//                              | IsPresent$ Permanent.namedBrothers Yamazaki
//                              | PresentCompare$ EQ2
//
// What it does (Forge): the matched cards are invisible to the legend
// rule grouping pass (CR 704.5j). The collector still walks all
// legendary permanents but skips a card if any active IgnoreLegendRule
// static matches it. This effectively treats the card as
// "non-legendary for the purposes of the legend rule" without
// stripping the supertype (which would be wrong — Boseiju, Who Endures
// still needs `Legendary` for its activated ability's cost paid by
// Land.Legendary, etc.).
//
// Routing: ruleChanging category — already mapped in MODE_TO_CATEGORY
// (ignoreLegendRule's enum entry preceded any handler). The describe()
// payload exposes `cardMatches`; the gate consumer
// (isExemptFromLegendRule in wave70j-rule-gates.ts) walks the registry
// per-query.
//
// MVP scope:
//   - ValidCard$ <filter> — Wave 32 grammar via cardMatchesFilter.
//   - Card.Self short-circuit honored (rare for this mode but valid).
//   - Default (no filter) → exempts every card (Mirror Gallery).
// TODO(advanced):
//   - IsPresent$ + PresentCompare$ conditional gate (Brothers Yamazaki:
//     "the rule doesn't apply ONLY when there are exactly two of them").
//     The MVP simplification accepts the static unconditionally; a
//     follow-up wave can add presence-conditional activation.
import type { EntityId, ParamValue, StaticAbility, StaticAst } from "@mtg-forge-ts/core";
import type { Game } from "../../game.js";
import {
  StaticHandler,
  type StaticHandlerCtx,
  normalizeActiveInZones,
  staticHandlerRegistry,
} from "../static-handler.js";
import { buildCardIdPredicate, literalRaw } from "./restriction-helpers.js";

export interface IgnoreLegendRulePayload {
  readonly kind: "ignoreLegendRule";
  readonly cardMatches: (cardId: EntityId, game: Game) => boolean;
}

export class IgnoreLegendRuleStaticHandler extends StaticHandler {
  static override readonly mode = "IgnoreLegendRule" as const;

  override build(ast: StaticAst, ctx: StaticHandlerCtx): StaticAbility {
    const params: Readonly<Record<string, ParamValue>> = ast.params;
    // Default to a match-everything predicate when ValidCard$ omitted —
    // Mirror Gallery's shape ("the legend rule doesn't apply" with no
    // filter) is the canonical case.
    const validCardRaw = literalRaw(params.ValidCard);
    const cardPred = buildCardIdPredicate(validCardRaw, ctx.sourceCardId, ctx.controllerSeat);

    const payload: IgnoreLegendRulePayload = {
      kind: "ignoreLegendRule",
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
      category: "ruleChanging",
      mode: "IgnoreLegendRule",
      describe: () => payload,
    };
  }
}

staticHandlerRegistry.register(IgnoreLegendRuleStaticHandler);
