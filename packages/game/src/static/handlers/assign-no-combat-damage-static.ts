// SPDX-License-Identifier: GPL-3.0-or-later
// Wave 70.N — AssignNoCombatDamage static handler. CR 510.1d / Forge's
// `S:Mode$ AssignNoCombatDamage`: matched creatures assign 0 combat damage
// regardless of their power.
//
// Forge cards using this:
//   - Sunhome Enforcer style "deals no combat damage"
//   - Indomitable Ancients (defender forms)
//   - The "cannot deal damage" curses
//   - ~26 cards across various sets
//
// DSL:
//   S:Mode$ AssignNoCombatDamage | ValidCard$ <filter> | Description$ ...
//
// What it does: matched creatures' combat damage assignment is 0 regardless
// of their power. Distinct from CombatDamageToughness (Wave 70.D) which uses
// toughness instead of power.
//
// Routing: ruleChanging — overrides CR 510.1c assignment. The combat-
// handler's `attackerPower` consults `assignsNoCombatDamage(game, cardId)`
// before reading chars.power; on match the value is 0 (this also takes
// precedence over CombatDamageToughness, since 0 trumps any toughness
// substitution — matches Forge: ANCD short-circuits in
// StaticAbilityAssignNoCombatDamage before CombatDamageToughness applies).
//
// MVP scope:
//   - ValidCard$ <filter>      → cardMatchesFilter (Wave 32 grammar).
//   - Card.Self short-circuit  → sourceCardId === cardId.
// Wave 109 — closes the prior TODO(advanced) tail. No Forge corpus card
// pairs AssignNoCombatDamage with Optional$ True; every shape in
// Forge's data is unconditional ("doesn't deal combat damage" / "deals
// no combat damage"). The cardMatches predicate is the durable
// contract.
import type { EntityId, ParamValue, StaticAbility, StaticAst } from "@mtg-forge-ts/core";
import type { Game } from "../../game.js";
import {
  StaticHandler,
  type StaticHandlerCtx,
  normalizeActiveInZones,
  staticHandlerRegistry,
} from "../static-handler.js";
import { buildCardIdPredicate, literalRaw } from "./restriction-helpers.js";

export interface AssignNoCombatDamagePayload {
  readonly kind: "assignNoCombatDamage";
  readonly cardMatches: (cardId: EntityId, game: Game) => boolean;
}

export class AssignNoCombatDamageStaticHandler extends StaticHandler {
  static override readonly mode = "AssignNoCombatDamage" as const;

  override build(ast: StaticAst, ctx: StaticHandlerCtx): StaticAbility {
    const params: Readonly<Record<string, ParamValue>> = ast.params;
    const validCardRaw = literalRaw(params.ValidCard) ?? "Card.Self";
    const cardPred = buildCardIdPredicate(validCardRaw, ctx.sourceCardId, ctx.controllerSeat);

    const payload: AssignNoCombatDamagePayload = {
      kind: "assignNoCombatDamage",
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
      mode: "AssignNoCombatDamage",
      describe: () => payload,
    };
  }
}

staticHandlerRegistry.register(AssignNoCombatDamageStaticHandler);
