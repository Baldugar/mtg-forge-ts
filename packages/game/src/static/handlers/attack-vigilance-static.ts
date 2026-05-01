// SPDX-License-Identifier: GPL-3.0-or-later
// Wave 70.G — AttackVigilance static handler. CR 506.5 / 702.20
// (vigilance) — "<creatures> attack as though they had vigilance" /
// "this creature attacks without tapping". The static-modeled cousin
// of the Vigilance keyword (which lives in Characteristics-as-keyword)
// — here the override is granted via static rather than baked-in
// keyword text.
//
// Forge cards using this (top frequency, ~11 cards in corpus):
//   - Archangel of Tithes        ("As long as CARDNAME is untapped,
//                                  creatures can't attack you…" — the
//                                  static form for the "doesn't tap" half)
//   - Hipparion                  (vigilance-shape variant)
//   - Hollow Warrior / Awesome Presence / Whipgrass Entangler
//                                (aura-shape "doesn't tap when attacking")
//   - Heat Wave / War Cadence / Cowed by Wisdom / Qal Sisma Behemoth
//                                (one-shot "creatures attack as though
//                                  they had vigilance" effects)
//   - Myr Prototype              (artifact-creature with the static)
//
// DSL examples (top corpus shapes):
//   S:Mode$ AttackVigilance | ValidCard$ Card.Self
//   S:Mode$ AttackVigilance | ValidCard$ Creature.YouCtrl
//   S:Mode$ AttackVigilance | ValidCard$ Creature
//
// What it does (Forge): when a matched creature attacks, it does NOT
// tap as part of declaring an attacker (vigilance-equivalent).
// CombatHandler.declareAttackers' attacker-tap pass consults
// `attacksWithVigilance(game, attackerId)` BEFORE setting tapped=true on
// the attacker; on a match the tap is suppressed (the creature attacks
// untapped). The Wave 7 vigilance-keyword path is the canonical "is
// vigilance keyword on this card?" — the static-driven gate runs in
// addition for cards that grant the property without a keyword stamp.
//
// Routing: cantMustMay category — already mapped in MODE_TO_CATEGORY
// (positive permission gate, registry-walk shape — same shape as
// CanAttackIfHaste / CanAttackDefender / CanBlockIfReach).
//
// Scope:
//   - ValidCard$ <filter>     — Wave 32 grammar via cardMatchesFilter.
//   - Card.Self short-circuit honored.
//
// Wave 108 — retired the stale "Trigger$ TrigDealDamage" TODO(advanced)
// tail. A corpus sweep at Wave 108 against Forge's res/cardsfolder
// confirmed no AttackVigilance static line carries a Trigger$ param
// (Glorybringer-shape "deals damage on exert" cards model the trigger
// as a separate T:Mode$ Attacks line, not as a sub-param of the
// vigilance static). Forge's StaticAbilityAttackVigilance likewise
// does not branch on a Trigger$ param. The ValidCard$ filter is the
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

export interface AttackVigilancePayload {
  readonly kind: "attackVigilance";
  readonly cardMatches: (cardId: EntityId, game: Game) => boolean;
}

export class AttackVigilanceStaticHandler extends StaticHandler {
  static override readonly mode = "AttackVigilance" as const;

  override build(ast: StaticAst, ctx: StaticHandlerCtx): StaticAbility {
    const params: Readonly<Record<string, ParamValue>> = ast.params;
    const validCardRaw = literalRaw(params.ValidCard) ?? "Card.Self";
    const cardPred = buildCardIdPredicate(validCardRaw, ctx.sourceCardId, ctx.controllerSeat);

    const payload: AttackVigilancePayload = {
      kind: "attackVigilance",
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
      category: "cantMustMay",
      mode: "AttackVigilance",
      describe: () => payload,
    };
  }
}

staticHandlerRegistry.register(AttackVigilanceStaticHandler);
