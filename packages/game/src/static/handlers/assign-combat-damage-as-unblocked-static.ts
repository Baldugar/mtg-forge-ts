// SPDX-License-Identifier: GPL-3.0-or-later
// Wave 70.F — AssignCombatDamageAsUnblocked static handler. CR 510 —
// blocked attacker's damage routes to defending player as if unblocked.
// Forge cards using this:
//   - Rogue's Passage analogue   (this creature can't be blocked / acts
//                                  as if unblocked vs its damage step)
//   - Bloodthorn Tine            (assigns damage as though unblocked)
//   - Tempting Wurm-shape gates  (the static-rules form, distinct from
//                                  the Trample keyword)
//
// DSL:
//   S:Mode$ AssignCombatDamageAsUnblocked | ValidCard$ <filter>
//                                         | Description$ ...
//
// What it does (Forge): when a creature matching the filter is blocked,
// it can still assign its combat damage as if unblocked — the damage
// goes to the declared defender (player / planeswalker / battle) instead
// of being divided among blockers. CR 510.1c-style override; mirrors
// Forge's StaticAbilityAssignCombatDamageAsUnblocked.assignCombatDamageAsUnblocked.
//
// Routing: ruleChanging category — already mapped in MODE_TO_CATEGORY.
// The combat-handler's dealDamage call site consults
// `assignsCombatDamageAsUnblocked(game, attackerId)` BEFORE the blocked-
// branch default-assignment is constructed; on a match the attacker
// damages the declared defender directly using its full power.
//
// MVP scope:
//   - ValidCard$ <filter> — Wave 32 grammar via cardMatchesFilter.
//   - Card.Self short-circuit honored (sourceCardId === cardId).
// TODO(advanced):
//   - Optional$ True (the matched attacker's controller may choose
//     whether to use the unblocked routing — currently always-on).
//   - Some Forge variants carry CombatDamage$ N split clauses; not yet
//     parsed.
import type { EntityId, ParamValue, StaticAbility, StaticAst } from "@mtg-forge-ts/core";
import type { Game } from "../../game.js";
import {
  StaticHandler,
  type StaticHandlerCtx,
  normalizeActiveInZones,
  staticHandlerRegistry,
} from "../static-handler.js";
import { buildCardIdPredicate, literalRaw } from "./restriction-helpers.js";

export interface AssignCombatDamageAsUnblockedPayload {
  readonly kind: "assignCombatDamageAsUnblocked";
  readonly cardMatches: (cardId: EntityId, game: Game) => boolean;
}

export class AssignCombatDamageAsUnblockedStaticHandler extends StaticHandler {
  static override readonly mode = "AssignCombatDamageAsUnblocked" as const;

  override build(ast: StaticAst, ctx: StaticHandlerCtx): StaticAbility {
    const params: Readonly<Record<string, ParamValue>> = ast.params;
    const validCardRaw = literalRaw(params.ValidCard) ?? "Card.Self";
    const cardPred = buildCardIdPredicate(validCardRaw, ctx.sourceCardId, ctx.controllerSeat);

    const payload: AssignCombatDamageAsUnblockedPayload = {
      kind: "assignCombatDamageAsUnblocked",
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
      mode: "AssignCombatDamageAsUnblocked",
      describe: () => payload,
    };
  }
}

staticHandlerRegistry.register(AssignCombatDamageAsUnblockedStaticHandler);
