// SPDX-License-Identifier: GPL-3.0-or-later
// Wave 50 — OptionalCost static handler. Forge's `S:Mode$ OptionalCost`
// registers a kicker-shape OPTIONAL ADDITIONAL cost. Distinct from
// AlternativeCost: optional costs are paid IN ADDITION to the base mana
// cost; alternative costs REPLACE it. (Surge/Awaken use AlternativeCost,
// Multikicker / Buyback / "may pay {1} as you cast" use OptionalCost.)
//
// Routing: `cantMustMay` category (per the canonical mode→category map in
// packages/core/src/abilities/static-ability-mode.ts). The describe()
// returns a Restriction whose kind is `optionalCost`; the payload field
// carries the cost string and the card/seat predicates so cast-pipeline
// can offer the option in stepChooseAltCosts. Wave 106 — closed the
// prior `// TODO(advanced)` tail: `gatherOptionalCosts(game, cardId,
// casterSeat)` (statics/cant-must-may-extras.ts) is the canonical
// collector that the cast-pipeline consults at stepChooseAltCosts; the
// payload shape registered here feeds it directly.
import type { EntityId, ParamValue, PlayerSeat, StaticAbility, StaticAst } from "@mtg-forge-ts/core";
import type { Restriction } from "../../statics/cant-must-may.js";
import {
  StaticHandler,
  type StaticHandlerCtx,
  normalizeActiveInZones,
  staticHandlerRegistry,
} from "../static-handler.js";
import { buildCardIdPredicate, buildPlayerPredicate, literalRaw } from "./restriction-helpers.js";

export interface OptionalCostPayload {
  readonly costRaw: string;
  readonly description: string | undefined;
  readonly seatMatches: (seat: PlayerSeat) => boolean;
}

export class OptionalCostStaticHandler extends StaticHandler {
  static override readonly mode = "OptionalCost" as const;

  override build(ast: StaticAst, ctx: StaticHandlerCtx): StaticAbility {
    const params: Readonly<Record<string, ParamValue>> = ast.params;
    const validRaw = literalRaw(params.ValidCard) ?? "Card.Self";
    const costRaw = literalRaw(params.Cost) ?? "0";
    const description = literalRaw(params.Description);
    const activatorRaw = literalRaw(params.Activator) ?? literalRaw(params.ValidActivator);

    const cardPred = buildCardIdPredicate(validRaw, ctx.sourceCardId, ctx.controllerSeat);
    const seatPred = buildPlayerPredicate(activatorRaw, ctx.controllerSeat);

    const payload: OptionalCostPayload = {
      costRaw,
      description,
      seatMatches: seatPred,
    };
    const restriction: Restriction = {
      sourceStaticId: ctx.staticId,
      kind: "optionalCost",
      subjectFilter: (id, game) => cardPred(id as EntityId, game),
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
      mode: "OptionalCost",
      describe: () => restriction,
    };
  }
}

staticHandlerRegistry.register(OptionalCostStaticHandler);
