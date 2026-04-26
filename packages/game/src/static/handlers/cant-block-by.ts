// SPDX-License-Identifier: GPL-3.0-or-later
// Wave 50 — CantBlockBy static handler. Forge's `S:Mode$ CantBlockBy` is
// the static-modeled cousin of Fear / Intimidate / Skulk. It reads two
// filters — the attacker side (Source$ Card.Self / ValidAttacker$ <filter>)
// and the blocker side (ValidBlocker$ <filter> / Valid$ <filter>) — and
// rejects block declarations where the attacker matches the source filter
// AND the blocker matches the blocker filter.
//
// Real cards (sample of 350):
//   - Fear (S:Mode$ CantBlockBy | ValidAttacker$ Card.Self | ValidBlocker$ Creature.nonBlack+nonArtifact)
//   - True-Faith Censer (gives "can't be blocked except by … 2+ creatures").
//
// Routing: registered as a `cantMustMay` static; its describe() returns a
// Restriction whose kind is `cantBlockBy`. block-restrictions.ts walks
// every CantBlockBy restriction during validateBlockDeclarations and
// rejects the block when both sides match.
import type { EntityId, ParamValue, StaticAbility, StaticAst } from "@mtg-forge-ts/core";
import type { Restriction } from "../../statics/cant-must-may.js";
import {
  StaticHandler,
  type StaticHandlerCtx,
  normalizeActiveInZones,
  staticHandlerRegistry,
} from "../static-handler.js";
import { buildCardIdPredicate, literalRaw } from "./restriction-helpers.js";

export class CantBlockByStaticHandler extends StaticHandler {
  static override readonly mode = "CantBlockBy" as const;

  override build(ast: StaticAst, ctx: StaticHandlerCtx): StaticAbility {
    const params: Readonly<Record<string, ParamValue>> = ast.params;
    const attackerRaw = literalRaw(params.ValidAttacker) ?? literalRaw(params.Source) ?? "Card.Self";
    const blockerRaw = literalRaw(params.ValidBlocker) ?? literalRaw(params.Valid) ?? "Card";

    const attackerPred = buildCardIdPredicate(attackerRaw, ctx.sourceCardId, ctx.controllerSeat);
    const blockerPred = buildCardIdPredicate(blockerRaw, ctx.sourceCardId, ctx.controllerSeat);

    const restriction: Restriction = {
      sourceStaticId: ctx.staticId,
      kind: "cantBlockBy",
      // subjectFilter receives the ATTACKER id; auxFilter receives BLOCKER.
      subjectFilter: (id, game) => attackerPred(id as EntityId, game),
      auxFilter: (id, game) => blockerPred(id as EntityId, game),
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
      mode: "CantBlockBy",
      describe: () => restriction,
    };
  }
}

staticHandlerRegistry.register(CantBlockByStaticHandler);
