// SPDX-License-Identifier: GPL-3.0-or-later
// Wave 74 — CantCrew static handler. CR 702.122 — Crew.
//
// Forge cards using this shape (~3 cards in corpus today):
//   - Revoke Privileges       (Aura — enchanted creature can't crew)
//   - Bound in Gold           (Aura — enchanted creature can't crew)
//   - Intercessor's Arrest    (Aura — enchanted creature can't crew)
//
// Combined DSL line shape (these cards co-emit CantAttack / CantBlock /
// CantCrew on the same static):
//   S:Mode$ CantAttack,CantBlock,CantCrew | ValidCard$ Creature.EnchantedBy | Description$ ...
//
// What it does (Forge): consulted at the Crew activation site
// (CrewEffect.resolve eligible-creature enumeration). When ValidCard$
// matches the candidate creature, the creature is dropped from the
// eligible-crewers pool — it can't be tapped to crew a Vehicle.
//
// Routing: replacementGenerating per MODE_TO_CATEGORY. Matches the
// rest of the Cant* family. The replacements list is empty; the gate
// is enforced at the Crew enumeration call site rather than via a
// derived replacement chain.
//
// MVP scope: ValidCard$ <filter> via buildCardIdPredicate (Card.Self,
// Creature.EnchantedBy, Wave 50/32 grammar). The "tap to crew" cost-
// payment surface goes through the same helper so the legal-action
// enumerator (Wave 50) likewise filters out gated creatures.
import type { EntityId, ParamValue, ReplacementAbility, StaticAbility, StaticAst } from "@mtg-forge-ts/core";
import type { Game } from "../../game.js";
import type { ReplacementGenPayload } from "../../statics/replacement-generating.js";
import {
  StaticHandler,
  type StaticHandlerCtx,
  normalizeActiveInZones,
  staticHandlerRegistry,
} from "../static-handler.js";
import { buildCardIdPredicate, literalRaw } from "./restriction-helpers.js";

export interface CantCrewPayload extends ReplacementGenPayload {
  readonly cardMatches: (cardId: EntityId, game: Game) => boolean;
}

export class CantCrewStaticHandler extends StaticHandler {
  static override readonly mode = "CantCrew" as const;

  override build(ast: StaticAst, ctx: StaticHandlerCtx): StaticAbility {
    const params: Readonly<Record<string, ParamValue>> = ast.params;
    const validCardRaw = literalRaw(params.ValidCard) ?? "Card";
    const cardPred = buildCardIdPredicate(validCardRaw, ctx.sourceCardId, ctx.controllerSeat);

    const payload: CantCrewPayload = {
      kind: "replacementGen",
      replacements: [] as readonly ReplacementAbility[],
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
      category: "replacementGenerating",
      mode: "CantCrew",
      describe: () => payload,
    };
  }
}

staticHandlerRegistry.register(CantCrewStaticHandler);
