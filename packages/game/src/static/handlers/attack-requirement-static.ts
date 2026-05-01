// SPDX-License-Identifier: GPL-3.0-or-later
// Wave 70.K — AttackRequirement static handler. CR 506 / 508 — "if
// CARDNAME attacks, it attacks <Defender> if able". Distinct from
// MustAttack (which forces ANY attack); this static restricts WHICH
// defender the attacker may attack. Goad-with-target-restriction and
// curse-shape "creatures attack you if able" use this.
//
// Forge cards using this:
//   - Goad-shape effects with target-restriction (the matched creature
//     attacks "a player other than its controller", canonically the
//     player who goaded it; modeled here as a required-defender filter)
//   - Curse of the Nightly Hunt-shape "creatures attack you if able"
//   - Vow auras: "enchanted creature attacks each turn if able and
//     can't attack you or planeswalkers you control"
//   - Marisi, Breaker of the Coil-style "all creatures attack <X>"
//
// DSL examples (top corpus shapes):
//   S:Mode$ AttackRequirement | ValidCard$ Creature.Self     | ValidDefender$ Player.Other
//   S:Mode$ AttackRequirement | ValidCard$ Creature.OppCtrl  | ValidDefender$ You
//   S:Mode$ AttackRequirement | ValidCard$ Creature          | ValidDefender$ You,Planeswalker.YouCtrl
//
// What it does (Forge): consulted at declareAttackers validation.
// When a matched creature attacks (attacker is in the declared
// attackers set), its declared defender MUST be one matched by
// ValidDefender$. If the matched creature attacks a defender that
// the static doesn't permit, the declaration is rejected.
//
// Routing: cantMustMay per MODE_TO_CATEGORY. The describe() payload
// exposes both per-card and per-defender predicates. The combat
// gate (attackRequirementsFor in wave70k-combat-gates.ts) walks
// the registry per-query.
//
// MVP scope:
//   - ValidCard$ <filter>      → cardMatchesFilter on attacker.
//   - ValidDefender$ <filter>  → composite player/planeswalker filter.
//                                 Recognised tokens for the player side:
//                                  "You" (controller of the static),
//                                  "Opponent" (any non-controller),
//                                  "Player" / "Any" (any seat),
//                                  "Player.Other" (any non-controller of
//                                   the attacker — modeled as non-
//                                   attacker-controller, see helper).
//                                 Planeswalker matching (ValidDefender$
//                                 Planeswalker.YouCtrl) is honored at the
//                                 helper site by walking the static
//                                 registry's payload predicate; MVP here
//                                 captures the raw filter string.
// Wave 112 closure of the prior advanced tail:
//   - Composite "You,Planeswalker.YouCtrl" is now resolved by the
//     `attackRequirementsFor` helper (wave70k-gate-helpers.ts) which
//     splits the comma-separated tokens into independent seat / PW /
//     battle sets and unions them into the allowed-defender result.
//   - "Player.Other" (= any seat that isn't the attacker's controller)
//     is also resolved by `attackRequirementsFor`, which has the
//     attacker's live controller seat in scope and can populate the
//     allowed-seats set with every other seat.
import type { EntityId, ParamValue, StaticAbility, StaticAst } from "@mtg-forge-ts/core";
import type { Game } from "../../game.js";
import {
  StaticHandler,
  type StaticHandlerCtx,
  normalizeActiveInZones,
  staticHandlerRegistry,
} from "../static-handler.js";
import { buildCardIdPredicate, literalRaw } from "./restriction-helpers.js";

/**
 * Read-side payload. The matching logic (which defender SEAT or
 * planeswalker EntityId is permitted) is parsed at the helper site
 * which has access to the attacker's controller and the full
 * candidate-defender list.
 */
export interface AttackRequirementPayload {
  readonly kind: "attackRequirement";
  /** True iff `attackerId` matches the static's ValidCard$ filter. */
  readonly attackerMatches: (attackerId: EntityId, game: Game) => boolean;
  /** Raw ValidDefender$ filter string (e.g. "You", "Player.Other", "You,Planeswalker.YouCtrl"). */
  readonly validDefenderRaw: string | undefined;
  /** Controller of the static (used to resolve "You" / "Opponent" defender tokens). */
  readonly staticControllerSeat: import("@mtg-forge-ts/core").PlayerSeat;
}

export class AttackRequirementStaticHandler extends StaticHandler {
  static override readonly mode = "AttackRequirement" as const;

  override build(ast: StaticAst, ctx: StaticHandlerCtx): StaticAbility {
    const params: Readonly<Record<string, ParamValue>> = ast.params;
    const validCardRaw = literalRaw(params.ValidCard) ?? "Creature";
    const cardPred = buildCardIdPredicate(validCardRaw, ctx.sourceCardId, ctx.controllerSeat);
    const validDefenderRaw = literalRaw(params.ValidDefender);

    const payload: AttackRequirementPayload = {
      kind: "attackRequirement",
      attackerMatches: (attackerId, game) => cardPred(attackerId, game),
      validDefenderRaw,
      staticControllerSeat: ctx.controllerSeat,
    };

    const activeInZones = normalizeActiveInZones(ast.activeInZones);
    return {
      id: ctx.staticId,
      kind: "static",
      sourceCardId: ctx.sourceCardId,
      activeInZones,
      timestamp: ctx.game.newEntityId(),
      controllerSeatAtReg: ctx.controllerSeat,
      category: "cantMustMay",
      mode: "AttackRequirement",
      describe: () => payload,
    };
  }
}

staticHandlerRegistry.register(AttackRequirementStaticHandler);
