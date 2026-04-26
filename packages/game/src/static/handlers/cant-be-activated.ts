// SPDX-License-Identifier: GPL-3.0-or-later
// Wave 50 — CantBeActivated static handler. Linvala (Mode$ CantBeActivated
// | ValidCard$ Card.OppCtrl | ValidSA$ Mana) and Pithing Needle ("activated
// abilities of the named permanent can't be activated"). The static
// matches against the permanent whose ability is being activated; the
// activation legality check (legal-action-enumerator) consults
// isRestricted("cantActivate", cardId).
//
// Routing: cantMustMay static, restriction kind = cantActivate. The
// existing `cantActivate` RestrictionKind already exists; this handler
// hooks into it.
//
// MVP scope: ValidSA$ Mana / Loyalty / Activated discrimination is `//
// TODO(advanced)` — the SP3 priority orchestrator does not yet enumerate
// activated abilities (legal-action-enumerator stops at castSpell), so
// the discrimination has no consumer to feed yet. Recording the param on
// the static for downstream readers.
import type { EntityId, ParamValue, PlayerSeat, StaticAbility, StaticAst } from "@mtg-forge-ts/core";
import type { Restriction } from "../../statics/cant-must-may.js";
import {
  StaticHandler,
  type StaticHandlerCtx,
  normalizeActiveInZones,
  staticHandlerRegistry,
} from "../static-handler.js";
import { buildCardIdPredicate, buildPlayerPredicate, literalRaw } from "./restriction-helpers.js";

export interface CantBeActivatedAuxPayload {
  readonly validSAKind: string | undefined;
}

export class CantBeActivatedStaticHandler extends StaticHandler {
  static override readonly mode = "CantBeActivated" as const;

  override build(ast: StaticAst, ctx: StaticHandlerCtx): StaticAbility {
    const params: Readonly<Record<string, ParamValue>> = ast.params;
    const validCardRaw = literalRaw(params.ValidCard) ?? "Card";
    const activatorRaw = literalRaw(params.ValidActivator) ?? literalRaw(params.Activator);
    const validSARaw = literalRaw(params.ValidSA);

    const cardPred = buildCardIdPredicate(validCardRaw, ctx.sourceCardId, ctx.controllerSeat);
    const seatPred = buildPlayerPredicate(activatorRaw, ctx.controllerSeat);

    const restriction: Restriction = {
      sourceStaticId: ctx.staticId,
      kind: "cantActivate",
      subjectFilter: (id, game) => cardPred(id as EntityId, game),
      auxFilter: (seat) => seatPred(seat as PlayerSeat),
      payload: { validSAKind: validSARaw } satisfies CantBeActivatedAuxPayload,
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
      mode: "CantBeActivated",
      describe: () => restriction,
    };
  }
}

staticHandlerRegistry.register(CantBeActivatedStaticHandler);
