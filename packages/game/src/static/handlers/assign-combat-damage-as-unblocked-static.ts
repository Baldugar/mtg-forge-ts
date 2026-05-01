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
// Wave 112 closure of the prior advanced tail:
//   - `Optional$ True` is now parsed onto the payload as
//     `optional: true`. The combat-handler's `dealDamage` consumer site
//     consults this field BEFORE routing damage to the defender; when
//     `optional` is set and the controller declines the routing (the
//     combat decision API surfaces the question), the canonical
//     blocked-branch assignment runs unchanged. The MVP default is
//     "auto-accept" (matching the Forge always-on behavior pre-toggle)
//     when no decision is offered.
//   - `CombatDamage$ N` is now parsed as a numeric `combatDamageOverride`
//     on the payload. When present, the unblocked-routed damage uses
//     `N` instead of the attacker's full power (Forge's "deal N damage
//     as if unblocked" split clause); when undefined, the attacker's
//     full power is used (the canonical CR 510.1c routing).
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
  /**
   * Wave 112 — `Optional$ True` flag. When true, the matched attacker's
   * controller MAY elect to route damage as unblocked (default acceptance
   * applies when no decision is offered, matching Forge's pre-toggle
   * always-on behavior). When false / undefined, routing is mandatory.
   */
  readonly optional: boolean;
  /**
   * Wave 112 — `CombatDamage$ N` split clause. When defined, the routed
   * damage uses this fixed value instead of the attacker's full power
   * (Forge's "deal N damage as if unblocked" form). undefined → use
   * attacker's full power (CR 510.1c canonical).
   */
  readonly combatDamageOverride: number | undefined;
}

export class AssignCombatDamageAsUnblockedStaticHandler extends StaticHandler {
  static override readonly mode = "AssignCombatDamageAsUnblocked" as const;

  override build(ast: StaticAst, ctx: StaticHandlerCtx): StaticAbility {
    const params: Readonly<Record<string, ParamValue>> = ast.params;
    const validCardRaw = literalRaw(params.ValidCard) ?? "Card.Self";
    const cardPred = buildCardIdPredicate(validCardRaw, ctx.sourceCardId, ctx.controllerSeat);
    // Wave 112 — Optional$ True flag (controller may decline the
    // unblocked routing). Forge accepts the literal "True" / "true" /
    // "1"; everything else is treated as omitted (= mandatory).
    const optionalRaw = literalRaw(params.Optional);
    const optional =
      optionalRaw !== undefined && (optionalRaw === "True" || optionalRaw === "true" || optionalRaw === "1");
    // Wave 112 — CombatDamage$ N split clause. Parse to a finite number;
    // negative / non-numeric / NaN values fall back to undefined
    // (canonical full-power routing).
    const combatDamageRaw = literalRaw(params.CombatDamage);
    const parsed = combatDamageRaw === undefined ? Number.NaN : Number.parseInt(combatDamageRaw, 10);
    const combatDamageOverride = Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;

    const payload: AssignCombatDamageAsUnblockedPayload = {
      kind: "assignCombatDamageAsUnblocked",
      cardMatches: (cardId, game) => cardPred(cardId, game),
      optional,
      combatDamageOverride,
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
