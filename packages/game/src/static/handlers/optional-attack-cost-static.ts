// SPDX-License-Identifier: GPL-3.0-or-later
// Wave 70.H — OptionalAttackCost static handler. CR 506.7 — "as a
// creature attacks, its controller may pay <Cost>. If they do,
// <Trigger>". The Forge static-modeled cousin of the Exert mechanic
// (Amonkhet block) and other "may pay X as it attacks" hooks.
//
// Forge cards using this (top frequency, ~28 cards in corpus —
// largest unwired static mode at the time of Wave 70.H):
//   - Ahn-Crop Champion / Ahn-Crop Crasher / Battlefield Scavenger
//                              (Exert<1/CARDNAME> as it attacks)
//   - Bitterblade Warrior / Champion of Rhonas / Combat Celebrant
//                              (Exert + Trigger$ <SVar> chain)
//   - Anointer of Champions / Vizier of Hazoret / Devoted Crop-Mate
//                              (Exert with conditional trigger payload)
//   - Glorybringer / Watchful Naga / Khenra Charioteer
//                              (Exert with downstream draw / pump triggers)
//
// DSL examples (top corpus shapes from the 28-card sweep):
//   S:Mode$ OptionalAttackCost | ValidCard$ Card.Self | Trigger$ TrigUntapAll | Cost$ Exert<1/CARDNAME> | Description$ ...
//   S:Mode$ OptionalAttackCost | ValidCard$ Card.Self | Cost$ Exert<1/CARDNAME>
//
// What it does (Forge): on attack-declaration, the controller of a
// creature matched by ValidCard$ MAY pay Cost$. If they do, the
// Trigger$ SVar fires (Forge resolves it as a delayed-trigger / one-
// shot effect bound to the matched attacker). The "may" choice is
// surfaced in the attack-declaration UI; the cost is paid alongside
// the tap (Exert is the canonical cost shape, but the param is
// generic — Forge accepts any cost string).
//
// Routing: cantMustMay category — already mapped in MODE_TO_CATEGORY
// (the OptionalCost / OptionalAttackCost siblings live alongside
// CantAttack / MustAttack / etc. on the cantMustMay registry, since
// the SP3 attack-declaration validator consults them in one sweep).
// The describe() payload returns a concrete Restriction with
// kind = "optionalCost" so the existing gatherRestrictions sweep
// surfaces it; the .payload slot carries the OptionalAttackCost-
// specific metadata (Trigger$ SVar key + Description$ text + the
// card-id predicate that scopes "which attackers may opt in").
//
// MVP scope:
//   - ValidCard$ <filter>          → cardMatchesFilter (Wave 32 grammar);
//                                    Forge defaults to Card.Self when
//                                    omitted, matching the Exert family.
//   - Cost$ <Forge cost string>    → captured as metadata. The cost-
//                                    payment dialog at attack-declaration
//                                    time is the consumer site (// TODO).
//   - Trigger$ <SVar key>          → captured as metadata. Forge
//                                    resolves the SVar as a one-shot
//                                    effect bound to the attacker
//                                    after the cost is paid.
//   - Description$ <text>          → captured for UI surfacing.
// TODO(advanced):
//   - Full cost-payment dialog at attack-declaration time (covers Exert,
//     Sac costs, Tap costs).
//   - Trigger$ SVar resolution as a delayed-trigger bound to the
//     attacker (today the SVar dispatch happens via the Wave 18 Exerted
//     trigger when the Exert cost is paid; this static-mode handler is
//     the registration side that the future cost-payment integration
//     will read).
//   - Multi-trigger forms ("Trigger$ TrigA, TrigB") — accepted as a
//     single literal today; Forge spells these as separate statics.
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

/** Read-side metadata: the cost text, trigger SVar, and matcher predicate. */
export interface OptionalAttackCostPayload {
  readonly kind: "optionalAttackCostExtended";
  /** True iff the candidate attacker matches ValidCard$. */
  readonly cardMatches: (cardId: EntityId, game: Game) => boolean;
  /** Forge cost string (e.g. "Exert<1/CARDNAME>", "1", "Sac<1/Land>"). undefined when omitted. */
  readonly costText: string | undefined;
  /** Forge Trigger$ SVar key (resolved by the cost-payment integration). undefined when omitted. */
  readonly triggerSVar: string | undefined;
  /** UI description text, surfaced by the attack-declaration dialog. undefined when omitted. */
  readonly description: string | undefined;
}

export class OptionalAttackCostStaticHandler extends StaticHandler {
  static override readonly mode = "OptionalAttackCost" as const;

  override build(ast: StaticAst, ctx: StaticHandlerCtx): StaticAbility {
    const params: Readonly<Record<string, ParamValue>> = ast.params;
    const validRaw = literalRaw(params.ValidCard) ?? "Card.Self";
    const cardPred = buildCardIdPredicate(validRaw, ctx.sourceCardId, ctx.controllerSeat);
    const costText = literalRaw(params.Cost);
    const triggerSVar = literalRaw(params.Trigger);
    const description = literalRaw(params.Description);

    const payload: OptionalAttackCostPayload = {
      kind: "optionalAttackCostExtended",
      cardMatches: (cardId, game) => cardPred(cardId, game),
      costText,
      triggerSVar,
      description,
    };

    // Translate to a concrete Restriction with kind=optionalCost so the
    // existing gatherRestrictions sweep can surface it alongside the
    // generic OptionalCost handler. The .payload slot carries the
    // OptionalAttackCost-specific metadata (Trigger$ + Description$ +
    // the attacker-scoped predicate).
    const restriction: Restriction = {
      sourceStaticId: ctx.staticId,
      kind: "optionalCost",
      subjectFilter: (subjectId, game) => {
        if (typeof subjectId !== "number" && typeof subjectId !== "object") return false;
        return cardPred(subjectId as EntityId, game);
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
      mode: "OptionalAttackCost",
      describe: () => restriction,
    };
  }
}

staticHandlerRegistry.register(OptionalAttackCostStaticHandler);
