// SPDX-License-Identifier: GPL-3.0-or-later
// Wave 70.L — ActivateAbilityAsIfHaste static handler. CR 302.6 carve-
// out: "you may activate abilities of <ValidCard$> as though those
// cards had haste". Distinct from CanAttackIfHaste (Wave 70.G) which
// targets the attack-declaration validator; this targets the activated-
// ability validator's tap-cost summoning-sickness check.
//
// Forge cards using this (3 cards in corpus):
//   - Dynaheir, Invoker Adept   ("You may activate abilities of other
//                                  creatures you control as though those
//                                  creatures had haste.")
//   - Thousand-Year Elixir      ("You may activate abilities of
//                                  creatures you control as though those
//                                  creatures had haste.")
//   - Tyvar, Jubilant Brawler   (same wording)
//
// DSL examples (corpus):
//   S:Mode$ ActivateAbilityAsIfHaste | ValidCard$ Creature.Other+YouCtrl+inZoneBattlefield
//   S:Mode$ ActivateAbilityAsIfHaste | ValidCard$ Creature.YouCtrl+inZoneBattlefield
//   S:Mode$ ActivateAbilityAsIfHaste | ValidCard$ Creature.YouCtrl
//
// What it does (Forge): consulted at the activated-ability validator
// when the cost contains a tap symbol (T) AND the source is a creature
// that entered this turn (would normally fail summoning sickness).
// When a matched static is in force, the summoning-sickness rejection
// is suppressed: the matched creature's activated ability fires.
//
// Routing: ruleChanging per MODE_TO_CATEGORY (Forge canonical category;
// it overrides the canonical haste / sickness rule). MVP-mode here uses
// the registry-walk pattern (Wave 70.D-K) — `canActivateAsIfHaste(game,
// cardId)` consults the active gates per query and returns true iff
// any matching static is in force.
//
// MVP scope:
//   - ValidCard$ <filter>     → cardMatchesFilter (Wave 32 grammar).
//                                Empty / undefined defaults to "Creature
//                                .YouCtrl" — the corpus norm.
//
// SP3 note: the engine's activate.ts does not currently enforce
// summoning sickness directly (deferred per ability/activate.ts header).
// Wiring this gate now ensures that, once the activate-time sickness
// gate is wired (via card.enteredAtTurn or similar), the matched
// statics already short-circuit the rejection. Read consumer is the
// helper in wave70l-gate-helpers.ts; the activate path consults it as a
// pre-check before any sickness reject.
import type { EntityId, ParamValue, StaticAbility, StaticAst } from "@mtg-forge-ts/core";
import type { Game } from "../../game.js";
import {
  StaticHandler,
  type StaticHandlerCtx,
  normalizeActiveInZones,
  staticHandlerRegistry,
} from "../static-handler.js";
import { buildCardIdPredicate, literalRaw } from "./restriction-helpers.js";

export interface ActivateAbilityAsIfHastePayload {
  readonly kind: "activateAbilityAsIfHaste";
  /** True iff `cardId` matches the static's ValidCard$ filter. */
  readonly cardMatches: (cardId: EntityId, game: Game) => boolean;
}

export class ActivateAbilityAsIfHasteStaticHandler extends StaticHandler {
  static override readonly mode = "ActivateAbilityAsIfHaste" as const;

  override build(ast: StaticAst, ctx: StaticHandlerCtx): StaticAbility {
    const params: Readonly<Record<string, ParamValue>> = ast.params;
    const validCardRaw = literalRaw(params.ValidCard) ?? "Creature.YouCtrl";
    const cardPred = buildCardIdPredicate(validCardRaw, ctx.sourceCardId, ctx.controllerSeat);

    const payload: ActivateAbilityAsIfHastePayload = {
      kind: "activateAbilityAsIfHaste",
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
      mode: "ActivateAbilityAsIfHaste",
      describe: () => payload,
    };
  }
}

staticHandlerRegistry.register(ActivateAbilityAsIfHasteStaticHandler);
