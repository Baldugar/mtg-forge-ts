// SPDX-License-Identifier: GPL-3.0-or-later
// Wave 50 — AlternativeCost static handler. Forge's `S:Mode$
// AlternativeCost` registers an alternative casting cost as a STATIC (not
// a card-side keyword). Surge (Welcome to the Fold) and Awaken (Halimar
// Tide-Caller) use this shape: the alt cost is offered when a teammate
// already cast a spell this turn / when an opponent is targeted, etc.
//
// Routing: `alternativeCost` category. The describe() payload carries the
// raw cost string and a player predicate so cast-pipeline can offer the
// option in stepChooseAltCosts. Wave-50 MVP — registration + payload
// shape; full integration into the cast-time alt-cost menu is a follow-up
// when SP3 lands the static-driven alt-cost surface (the existing
// AltCostRegistry uses keyword-based registration; weaving the static
// payload into that registry's `available()` sweep is `// TODO(advanced)`
// — see registries/alt-cost-registry.ts).
import type { EntityId, ParamValue, PlayerSeat, StaticAbility, StaticAst } from "@mtg-forge-ts/core";
import {
  StaticHandler,
  type StaticHandlerCtx,
  normalizeActiveInZones,
  staticHandlerRegistry,
} from "../static-handler.js";
import { buildCardIdPredicate, buildPlayerPredicate, literalRaw } from "./restriction-helpers.js";

export interface AlternativeCostPayload {
  readonly kind: "alternativeCost";
  readonly sourceStaticId: EntityId;
  readonly costRaw: string;
  readonly description: string | undefined;
  readonly cardMatches: (cardId: EntityId, game: import("../../game.js").Game) => boolean;
  readonly seatMatches: (seat: PlayerSeat) => boolean;
}

export class AlternativeCostStaticHandler extends StaticHandler {
  static override readonly mode = "AlternativeCost" as const;

  override build(ast: StaticAst, ctx: StaticHandlerCtx): StaticAbility {
    const params: Readonly<Record<string, ParamValue>> = ast.params;
    const validRaw = literalRaw(params.ValidCard) ?? "Card.Self";
    const costRaw = literalRaw(params.Cost) ?? "0";
    const description = literalRaw(params.Description);
    const activatorRaw = literalRaw(params.Activator) ?? literalRaw(params.ValidActivator);

    const cardPred = buildCardIdPredicate(validRaw, ctx.sourceCardId, ctx.controllerSeat);
    const seatPred = buildPlayerPredicate(activatorRaw, ctx.controllerSeat);

    const payload: AlternativeCostPayload = {
      kind: "alternativeCost",
      sourceStaticId: ctx.staticId,
      costRaw,
      description,
      cardMatches: cardPred,
      seatMatches: seatPred,
    };

    const activeInZones = normalizeActiveInZones(ast.activeInZones);
    return {
      id: ctx.staticId,
      kind: "static",
      sourceCardId: ctx.sourceCardId,
      activeInZones,
      timestamp: ctx.game.newEntityId(),
      controllerSeatAtReg: ctx.controllerSeat,
      category: "alternativeCost",
      mode: "AlternativeCost",
      describe: () => payload,
    };
  }
}

staticHandlerRegistry.register(AlternativeCostStaticHandler);
