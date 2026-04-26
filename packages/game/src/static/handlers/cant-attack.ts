// SPDX-License-Identifier: GPL-3.0-or-later
// Wave 50 — CantAttack static handler. Propaganda-style "creatures can't
// attack you (or [planeswalker]) unless their controller pays {2}" along
// with the simpler "creatures can't attack" emblems. The MVP shipped here
// covers the unconditional restriction: ValidCard$ matches against the
// attacker; if the static is active, those attackers can't attack at all.
// UnlessCost$ (the "pay {2}" payment carve-out) is `// TODO(advanced)`.
//
// Routing: cantMustMay static, restriction kind = cantAttack. The
// validateAttackDeclarations sweep (combat-handler) walks every cantAttack
// restriction during attack legality.
import type { EntityId, ParamValue, StaticAbility, StaticAst } from "@mtg-forge-ts/core";
import type { Restriction } from "../../statics/cant-must-may.js";
import {
  StaticHandler,
  type StaticHandlerCtx,
  normalizeActiveInZones,
  staticHandlerRegistry,
} from "../static-handler.js";
import { buildCardIdPredicate, literalRaw } from "./restriction-helpers.js";

export class CantAttackStaticHandler extends StaticHandler {
  static override readonly mode = "CantAttack" as const;

  override build(ast: StaticAst, ctx: StaticHandlerCtx): StaticAbility {
    const params: Readonly<Record<string, ParamValue>> = ast.params;
    const validRaw = literalRaw(params.ValidCard) ?? "Card.Self";
    const pred = buildCardIdPredicate(validRaw, ctx.sourceCardId, ctx.controllerSeat);

    const restriction: Restriction = {
      sourceStaticId: ctx.staticId,
      kind: "cantAttack",
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
      mode: "CantAttack",
      describe: () => restriction,
    };
  }
}

staticHandlerRegistry.register(CantAttackStaticHandler);
