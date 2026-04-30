// SPDX-License-Identifier: GPL-3.0-or-later
// Wave 70.K — CantAttach static handler. Forge's
// StaticAbilityCantAttach.java — pure negative attach-permission gate.
// The matched equipments / auras (ValidCard$) cannot be attached to
// the matched targets (ValidTarget$).
//
// Forge cards using this:
//   - True Believer / Witchbane Orb     ("you and permanents you control
//                                          can't be enchanted by Auras
//                                          your opponents control")
//   - Sigarda, Host of Herons           ("Spells and abilities your
//                                          opponents control can't make
//                                          you sacrifice or be enchanted")
//   - Story Circle attach-restriction siblings
//   - Hexproof analogues at attach-time (the rare "can't be enchanted"
//     shape that doesn't grant the keyword but reads as the same gate)
//   - Ouphe-tribe-style "creatures you control can't be enchanted by Auras"
//
// DSL examples (top corpus shapes):
//   S:Mode$ CantAttach | ValidCard$ Aura.OppCtrl | ValidTarget$ You
//   S:Mode$ CantAttach | ValidCard$ Aura.OppCtrl | ValidTarget$ Card.Self,Permanent.YouCtrl
//   S:Mode$ CantAttach | ValidCard$ Equipment | ValidTarget$ Creature.YouCtrl
//
// What it does (Forge): consulted at the attach action site. When a
// matched equipment / aura would attach to a matched target, the
// attach is rejected. Matches the cast-time choose-target rejection
// for Auras (the cast can't legally choose the target), AND the
// activated-ability Equip rejection (the activation's target is
// invalid), AND the static-cause auto-attach rejection (For Mirrodin /
// Living Weapon spawn that would auto-attach the equipment to a token
// that the static gates).
//
// Routing: replacementGenerating per MODE_TO_CATEGORY (the canonical
// Forge category — CantAttach generates a replacement that prevents
// the attach intent). MVP-mode here uses the registry-walk pattern
// (Wave 70.D-J) — `canAttach(game, equipmentId, targetId)` consults
// the active CantAttach gates per attach site. We emit a payload
// (NOT a full Restriction) since attach-action consumers walk the
// registry directly via the canAttach helper; matching the pattern
// established by Wave 70.D's CantTarget.
//
// MVP scope:
//   - ValidCard$ <filter>     → cardMatchesFilter applied to the
//                                attaching card (equipment / aura).
//   - ValidTarget$ <filter>   → cardMatchesFilter applied to the
//                                attachment target.
//   - ValidPlayerTarget$      → TODO(advanced): "can't be attached to
//                                player <X>" (rare; only Curse-shape
//                                auras attach to players).
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
 * Read-side payload exposing per-side predicates the gate consults.
 * The match logic is AND across both: the attaching card must match
 * ValidCard$ AND the candidate attachment target must match
 * ValidTarget$ for the gate to reject.
 */
export interface CantAttachPayload {
  readonly kind: "cantAttach";
  /** True iff the attaching card (equipment / aura) matches ValidCard$. */
  readonly equipmentMatches: (cardId: EntityId, game: Game) => boolean;
  /** True iff the candidate attachment target matches ValidTarget$. */
  readonly targetMatches: (cardId: EntityId, game: Game) => boolean;
}

export class CantAttachStaticHandler extends StaticHandler {
  static override readonly mode = "CantAttach" as const;

  override build(ast: StaticAst, ctx: StaticHandlerCtx): StaticAbility {
    const params: Readonly<Record<string, ParamValue>> = ast.params;
    // ValidCard$ default — match every potential attaching card. The
    // Forge canonical scripts always set ValidCard$, but the safer
    // default is "any" so the gate doesn't accidentally over-restrict
    // when a forgetful card script omits the filter.
    const validCardRaw = literalRaw(params.ValidCard);
    const validTargetRaw = literalRaw(params.ValidTarget);
    const equipmentPred =
      validCardRaw === undefined
        ? () => true
        : buildCardIdPredicate(validCardRaw, ctx.sourceCardId, ctx.controllerSeat);
    const targetPred =
      validTargetRaw === undefined
        ? () => true
        : buildCardIdPredicate(validTargetRaw, ctx.sourceCardId, ctx.controllerSeat);

    const payload: CantAttachPayload = {
      kind: "cantAttach",
      equipmentMatches: (cardId, game) => equipmentPred(cardId, game),
      targetMatches: (cardId, game) => targetPred(cardId, game),
    };

    const activeInZones = normalizeActiveInZones(ast.activeInZones);
    return {
      id: ctx.staticId,
      kind: "static",
      sourceCardId: ctx.sourceCardId,
      activeInZones,
      timestamp: ctx.game.newEntityId(),
      controllerSeatAtReg: ctx.controllerSeat,
      // Routed cantMustMay: even though MODE_TO_CATEGORY tags
      // CantAttach as "replacementGenerating" (matching Forge's source-
      // of-truth), this MVP runs as an action-filter consulted at the
      // attach call site (mirrors the Wave 70.D-J pattern). The
      // canonical replacement-emitter integration is a TODO(advanced).
      category: "cantMustMay",
      mode: "CantAttach",
      describe: () => payload,
    };
  }
}

staticHandlerRegistry.register(CantAttachStaticHandler);
