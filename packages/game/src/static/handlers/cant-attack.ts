// SPDX-License-Identifier: GPL-3.0-or-later
// Wave 50 — CantAttack static handler. Propaganda-style "creatures can't
// attack you (or [planeswalker]) unless their controller pays {2}" along
// with the simpler "creatures can't attack" emblems. The MVP shipped here
// covers the unconditional restriction: ValidCard$ matches against the
// attacker; if the static is active, those attackers can't attack at all.
//
// Wave 104 — UnlessCost$ + ValidDefender$ are surfaced on the payload
// (parallel to the Wave 70.J CantBlockUnless shape via
// `cant-block-unless-static.ts`). The combat-handler's
// validateAttackDeclarations sweep continues to deny attack on any
// match (the MVP treats the unless-cost as unpaid), but the cost text
// + defender-filter now sit on `restriction.payload` so the future
// cost-payment dialog and per-defender carve-out can read them
// uniformly without a second registry walk.
//
// Routing: cantMustMay static, restriction kind = cantAttack. The
// validateAttackDeclarations sweep (combat-handler) walks every cantAttack
// restriction during attack legality.
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

/**
 * Read-side metadata for CantAttack: the optional unless-cost text and
 * the optional ValidDefender$ filter (Propaganda-shape "can't attack
 * YOU unless …" — restricts the gate to a specific defender). The full
 * cost-payment dialog at attack-declaration time is the future hook;
 * the validator already denies on a match because the MVP treats the
 * unless-cost as unpaid.
 */
export interface CantAttackPayload {
  readonly kind: "cantAttackExtended";
  readonly cardMatches: (cardId: EntityId, game: Game) => boolean;
  /** Forge cost string (e.g. "2", "PayLife<1>"). undefined when omitted. */
  readonly costText: string | undefined;
  /** Forge ValidDefender$ filter (e.g. "Planeswalker.YouCtrl"). undefined when omitted. */
  readonly defenderFilterRaw: string | undefined;
}

export class CantAttackStaticHandler extends StaticHandler {
  static override readonly mode = "CantAttack" as const;

  override build(ast: StaticAst, ctx: StaticHandlerCtx): StaticAbility {
    const params: Readonly<Record<string, ParamValue>> = ast.params;
    const validRaw = literalRaw(params.ValidCard) ?? "Card.Self";
    const pred = buildCardIdPredicate(validRaw, ctx.sourceCardId, ctx.controllerSeat);
    // Wave 104 — surface UnlessCost$ + ValidDefender$ on the payload.
    // Both are optional; when omitted the gate degenerates to the
    // legacy unconditional shape.
    const costText = literalRaw(params.UnlessCost) ?? literalRaw(params.Cost);
    const defenderFilterRaw = literalRaw(params.ValidDefender) ?? literalRaw(params.Defender);

    const payload: CantAttackPayload = {
      kind: "cantAttackExtended",
      cardMatches: (id, game) => pred(id, game),
      costText,
      defenderFilterRaw,
    };

    const restriction: Restriction = {
      sourceStaticId: ctx.staticId,
      kind: "cantAttack",
      subjectFilter: (id, game) => pred(id as EntityId, game),
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
      mode: "CantAttack",
      describe: () => restriction,
    };
  }
}

staticHandlerRegistry.register(CantAttackStaticHandler);
