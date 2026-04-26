// SPDX-License-Identifier: GPL-3.0-or-later
// Wave 50 — CantBlock static handler. Forge's `S:Mode$ CantBlock` rejects
// block declarations from creatures matching ValidCard$. The "Defender"
// keyword has its own combat-handler short-circuit; this static covers the
// general "[these creatures] can't block" shape (Maze of Shadows-style
// per-turn restrictions, "creatures with X can't block" emblems, etc.).
//
// Routing: cantMustMay static, restriction kind = cantBlock. The existing
// `cantBlock` RestrictionKind is reused — the cant-must-may sweep in
// validateBlockDeclarations rejects any blocker matching ValidCard$.
import type { EntityId, ParamValue, StaticAbility, StaticAst } from "@mtg-forge-ts/core";
import type { Restriction } from "../../statics/cant-must-may.js";
import {
  StaticHandler,
  type StaticHandlerCtx,
  normalizeActiveInZones,
  staticHandlerRegistry,
} from "../static-handler.js";
import { buildCardIdPredicate, literalRaw } from "./restriction-helpers.js";

export class CantBlockStaticHandler extends StaticHandler {
  static override readonly mode = "CantBlock" as const;

  override build(ast: StaticAst, ctx: StaticHandlerCtx): StaticAbility {
    const params: Readonly<Record<string, ParamValue>> = ast.params;
    const validRaw = literalRaw(params.ValidCard) ?? "Card.Self";
    const pred = buildCardIdPredicate(validRaw, ctx.sourceCardId, ctx.controllerSeat);

    const restriction: Restriction = {
      sourceStaticId: ctx.staticId,
      kind: "cantBlock",
      subjectFilter: (id, game) => pred(id as EntityId, game),
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
      mode: "CantBlock",
      describe: () => restriction,
    };
  }
}

staticHandlerRegistry.register(CantBlockStaticHandler);
