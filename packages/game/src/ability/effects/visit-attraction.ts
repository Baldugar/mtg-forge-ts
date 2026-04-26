// SPDX-License-Identifier: GPL-3.0-or-later
// VisitAttractionEffect — Forge `SP$ VisitAttraction` (Unfinity).
//
// Forge models Attraction visits as: when a player rolls the attraction die
// for an open Attraction (visit roll), the matching Attraction's "visit"
// trigger fires. The MVP scope here is to emit the canonical
// AttractionVisited event so VisitAttractionTrigger (Wave 22) fires; the
// actual Attraction-deck mechanics (rolling the die, opening / closing
// attractions, prize selection) are deferred — they're niche, Unfinity-only,
// and can be layered on top of this primitive.
//
// Inputs:
//   Defined$ <attractionId>   — optional; if present, the effect names the
//                               specific Attraction that was visited. If
//                               absent, the source card is treated as the
//                               attraction (sa.sourceCardId).
//
// Output:
//   yields one AttractionVisited event { attractionId, playerSeat } where
//   playerSeat = the activator (sa.controllerSeat).
import type { EntityId } from "@mtg-forge-ts/core";
import { mkEvent } from "@mtg-forge-ts/core";
import type { EngineYield } from "../../action/engine-yield.js";
import type { Game } from "../../game.js";
import { effectRegistry } from "../effect-registry.js";
import { evaluateParamRaw, hasParam } from "../evaluate-param.js";
import { SpellAbilityEffect } from "../spell-ability-effect.js";
import type { SpellAbility } from "../spell-ability.js";

export class VisitAttractionEffect extends SpellAbilityEffect {
  static override readonly handlerKey = "VisitAttraction";

  override *resolve(sa: SpellAbility, game: Game): Generator<EngineYield, void, unknown> {
    let attractionId: EntityId = sa.sourceCardId;
    if (hasParam(sa, "Defined")) {
      const raw = evaluateParamRaw(sa, "Defined");
      // Defined$ <id> may be a numeric id when used in tests / explicit
      // routing, or a symbolic name like "Self" / "Source" handled by the
      // standard defined-resolver elsewhere. For MVP, accept a numeric
      // string and otherwise fall through to source.
      const asNum = Number(raw);
      if (Number.isFinite(asNum) && Number.isInteger(asNum) && asNum > 0) {
        attractionId = asNum as EntityId;
      }
    }

    yield game.emitEvent(
      mkEvent("AttractionVisited", game.turn, game.phase, {
        attractionId,
        playerSeat: sa.controllerSeat,
      }),
    );
  }
}

effectRegistry.register(VisitAttractionEffect);
