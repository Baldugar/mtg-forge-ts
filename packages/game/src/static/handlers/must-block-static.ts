// SPDX-License-Identifier: GPL-3.0-or-later
// Wave 70.G — MustBlock static handler. CR 509.1g — "<creature> blocks
// this turn if able" / "<creatures> block <attacker> if able". The
// static-modeled cousin of the SP$ MustBlock effect (Wave 18) and the
// Lure / Provoke keyword family.
//
// Forge cards using this (top frequency, ~27 cards in corpus):
//   - Provoke                  ("That creature blocks this turn if able.")
//   - Brutal Hordechief        (activated effect — opponents' creatures
//                                must block this combat if able)
//   - Lure-shape statics
//   - Hustle Bustle / Domineering Will / Boros Battleshaper / Watchdog
//                              (force-block emblems and effects)
//   - Mark for Death / Berserker's Frenzy / Targeting Rocket
//                              (one-shot must-block statics on Effect
//                                exile-on-moved hosts)
//   - Razorgrass Screen / Spirespine / Kharn the Betrayer
//                              (must-block-this aura-shape forcers)
//
// DSL examples (top corpus shapes from the 27-card sweep):
//   S:Mode$ MustBlock | ValidCreature$ Card.IsRemembered
//   S:Mode$ MustBlock | ValidCreature$ Creature.OppCtrl
//   S:Mode$ MustBlock | ValidCreature$ Creature.Self
//   S:Mode$ MustBlock | ValidCreature$ Creature.YouCtrl | Attacker$ Creature.Self
//
// What it does (Forge): the matched creature(s) MUST block during the
// declare-blockers step "if able". The combat-handler's blocker-
// declaration validator already gathers `mustBlock` restrictions; this
// handler stamps the registry entry consumed by that sweep.
//
// Routing: cantMustMay category — already mapped in MODE_TO_CATEGORY.
// The describe() payload returns a concrete Restriction with kind =
// "mustBlock". The existing gatherRestrictions("mustBlock") sweep
// surfaces it; the SP3 attacker-chooses-blockers flow + auto-correct
// at end of declareBlockers consult the kind directly.
//
// MVP scope:
//   - ValidCreature$ <filter>     → cardMatchesFilter (Wave 32 grammar);
//                                    Forge sometimes spells this
//                                    "ValidCard$" — both are accepted.
//   - Card.Self / Card.IsRemembered short-circuits via the predicate.
//   - The attacker-side "Attacker$" sub-param is captured on the payload
//     for callers that want to enforce target-specific must-block (e.g.
//     "must block CARDNAME if able").
// TODO(advanced):
//   - "If able" gating against tap state, summoning sickness, CantBlock
//     statics is currently the caller's responsibility (mirror of how
//     MustAttack works in CombatHandler.applyMustAttack).
//   - Multi-target must-block-one-of-{A,B,C} forms.
import type { EntityId, ParamValue, StaticAbility, StaticAst } from "@mtg-forge-ts/core";
import type { Game } from "../../game.js";
import type { Restriction } from "../../statics/cant-must-may.js";
import {
  StaticHandler,
  type StaticHandlerCtx,
  normalizeActiveInZones,
  staticHandlerRegistry,
} from "../static-handler.js";
import { buildCardIdPredicate, literalRaw } from "./restriction-helpers.js";

/**
 * Read-side metadata: the attacker filter (when present) is exposed
 * via Restriction.payload so callers needing target-specific must-block
 * (e.g. "must block CARDNAME if able") can read it without re-parsing
 * the static.
 */
export interface MustBlockPayload {
  readonly kind: "mustBlockExtended";
  /** True iff the candidate blocker matches ValidCreature$ / ValidCard$. */
  readonly blockerMatches: (cardId: EntityId, game: Game) => boolean;
  /**
   * True iff the candidate attacker matches Attacker$. Always-true when
   * Attacker$ is omitted (= must block any attacker).
   */
  readonly attackerMatches: (cardId: EntityId, game: Game) => boolean;
  /** Forge attacker filter raw (e.g. "Creature.Self"). undefined when omitted. */
  readonly attackerFilterRaw: string | undefined;
}

export class MustBlockStaticHandler extends StaticHandler {
  static override readonly mode = "MustBlock" as const;

  override build(ast: StaticAst, ctx: StaticHandlerCtx): StaticAbility {
    const params: Readonly<Record<string, ParamValue>> = ast.params;
    // Forge spells the param both as ValidCreature$ and ValidCard$
    // depending on script age — accept either, with ValidCreature$ taking
    // precedence (matches Forge's StaticAbilityMustBlock.java parser).
    const blockerRaw = literalRaw(params.ValidCreature) ?? literalRaw(params.ValidCard) ?? "Card.Self";
    const blockerPred = buildCardIdPredicate(blockerRaw, ctx.sourceCardId, ctx.controllerSeat);

    const attackerRaw = literalRaw(params.Attacker) ?? literalRaw(params.ValidAttacker);
    const attackerPred =
      attackerRaw === undefined
        ? () => true
        : buildCardIdPredicate(attackerRaw, ctx.sourceCardId, ctx.controllerSeat);

    const payload: MustBlockPayload = {
      kind: "mustBlockExtended",
      blockerMatches: (cardId, game) => blockerPred(cardId, game),
      attackerMatches: (cardId, game) => attackerPred(cardId, game),
      attackerFilterRaw: attackerRaw,
    };

    const restriction: Restriction = {
      sourceStaticId: ctx.staticId,
      kind: "mustBlock",
      subjectFilter: (subjectId, game) => {
        if (typeof subjectId !== "number" && typeof subjectId !== "object") return false;
        return blockerPred(subjectId as EntityId, game);
      },
      payload,
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
      mode: "MustBlock",
      describe: () => restriction,
    };
  }
}

staticHandlerRegistry.register(MustBlockStaticHandler);
