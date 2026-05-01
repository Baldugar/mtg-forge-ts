// SPDX-License-Identifier: GPL-3.0-or-later
// Wave 70.D — CombatDamageToughness static handler. CR 702.95 (Doran-
// shape): "<filtered creature> assigns combat damage equal to its
// toughness rather than its power".
//
// Forge cards using this:
//   - Doran, the Siege Tower      (each creature uses toughness)
//   - Assault Formation            (creatures you control use toughness)
//   - Belligerent Brontodon        (your creatures use toughness)
//   - High Alert                   (defender clause + toughness)
//   - Huatli, the Sun's Heart      (planeswalker enabling Doran-shape)
//   - Sumo Spirit                  (during your turn)
//
// DSL examples:
//   S:Mode$ CombatDamageToughness | ValidCard$ Creature.YouCtrl
//   S:Mode$ CombatDamageToughness | ValidCard$ Creature.powerLTtoughness+YouCtrl
//   S:Mode$ CombatDamageToughness | ValidCard$ Creature.withDefender+YouCtrl
//   S:Mode$ CombatDamageToughness | ValidCard$ Creature
//
// What it does: the combat-damage-assignment site (combat-handler →
// attackerPower) consults `usesToughnessForCombatDamage(game, cid)`;
// on match, it returns the layered `chars.toughness` clamped at 0
// instead of `chars.power`.
//
// Routing: ruleChanging — overrides the canonical CR 702.95 rule. The
// describe() payload returns `cardMatches(cardId)` for the consumer
// helper to short-circuit the substitution.
//
// MVP scope:
//   - ValidCard$ <filter>      → cardMatchesFilter (Wave 32 grammar).
//   - Card.Self short-circuit  → sourceCardId === cardId.
// Wave 109 — closes the prior TODO(advanced) tail. Both bullets were
// observations of correct existing behaviour rather than open work:
// overlapping-filter first-match-wins is already what the helper
// returns; Secondary$ / aura-shape combined +0/+2 + use-toughness is
// already independent of this static (the AddPower / AddToughness
// layer runs through Continuous). The cardMatches predicate is the
// durable contract.
import type { EntityId, ParamValue, StaticAbility, StaticAst } from "@mtg-forge-ts/core";
import type { Game } from "../../game.js";
import {
  StaticHandler,
  type StaticHandlerCtx,
  normalizeActiveInZones,
  staticHandlerRegistry,
} from "../static-handler.js";
import { buildCardIdPredicate, literalRaw } from "./restriction-helpers.js";

export interface CombatDamageToughnessPayload {
  readonly kind: "combatDamageToughness";
  readonly cardMatches: (cardId: EntityId, game: Game) => boolean;
}

export class CombatDamageToughnessStaticHandler extends StaticHandler {
  static override readonly mode = "CombatDamageToughness" as const;

  override build(ast: StaticAst, ctx: StaticHandlerCtx): StaticAbility {
    const params: Readonly<Record<string, ParamValue>> = ast.params;
    const validRaw = literalRaw(params.ValidCard) ?? "Creature";
    const cardPred = buildCardIdPredicate(validRaw, ctx.sourceCardId, ctx.controllerSeat);

    const payload: CombatDamageToughnessPayload = {
      kind: "combatDamageToughness",
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
      mode: "CombatDamageToughness",
      describe: () => payload,
    };
  }
}

staticHandlerRegistry.register(CombatDamageToughnessStaticHandler);
