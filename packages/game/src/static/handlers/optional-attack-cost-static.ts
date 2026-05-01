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
// Wave 107 — closes the prior multi-trigger form TODO(advanced) tail.
// `triggerSVar` is now a tuple shape: when the corpus carries
// `Trigger$ TrigA & TrigB` (Forge's `&`-separator for multi-trigger
// statics) we split on `&` (and the `,` legacy separator) and expose
// both keys via `triggerSVarsAll`. The legacy single-string slot
// (`triggerSVar`) keeps the first key for back-compat with the
// existing Wave 18 Exerted dispatcher; the cost-payment integration
// can iterate `triggerSVarsAll` once it lands.
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
  /**
   * First Forge Trigger$ SVar key (resolved by the cost-payment integration).
   * undefined when omitted. Back-compat slot that mirrors the pre-Wave-107
   * single-key shape. Iterate `triggerSVarsAll` for the full list when the
   * corpus carries a `Trigger$ TrigA & TrigB` multi-trigger form.
   */
  readonly triggerSVar: string | undefined;
  /**
   * Wave 107 — full Trigger$ multi-trigger list. Single-trigger forms
   * resolve to a one-element array; the `&`-separator (Forge canonical)
   * and the `,`-separator (corpus legacy) both split into independent
   * keys. Empty when Trigger$ is omitted.
   */
  readonly triggerSVarsAll: readonly string[];
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
    const triggerRaw = literalRaw(params.Trigger);
    // Wave 107 — split on Forge's `&` separator (and the `,` legacy form)
    // for multi-trigger statics. Single-trigger lines resolve to a
    // one-element array; absent Trigger$ resolves to an empty array.
    const triggerSVarsAll: readonly string[] =
      triggerRaw === undefined || triggerRaw.length === 0
        ? []
        : triggerRaw
            .split(/[&,]/)
            .map((t) => t.trim())
            .filter((t) => t.length > 0);
    const triggerSVar = triggerSVarsAll[0];
    const description = literalRaw(params.Description);

    const payload: OptionalAttackCostPayload = {
      kind: "optionalAttackCostExtended",
      cardMatches: (cardId, game) => cardPred(cardId, game),
      costText,
      triggerSVar,
      triggerSVarsAll,
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
