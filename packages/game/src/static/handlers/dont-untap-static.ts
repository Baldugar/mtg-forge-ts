// SPDX-License-Identifier: GPL-3.0-or-later
// Wave 60 — DontUntap static handler. Stasis-style "permanents don't
// untap during their controller's untap step". Examples:
//
//   S:Mode$ DontUntap | ValidCard$ Permanent       (Stasis)
//   S:Mode$ DontUntap | ValidCard$ Creature.YouCtrl
//
// Routing: cantMustMay category, restriction kind = `cantUntap` (an
// existing RestrictionKind in cant-must-may.ts). The phase-handler's
// untap-step loop consults `isRestricted(game, "cantUntap", cardId)`
// before invoking `action.untap`; matching cards are silently skipped.
//
// MVP — the basic ValidCard$ filter is the durable contract. Forge's
// Stasis text reads "Permanents don't untap during their controllers'
// untap steps" without any per-controller carve-out for whose step it
// is, so the simplest model (skip the untap if any DontUntap active
// matches the card) is correct for Stasis itself.
//
// Conditional shapes ("only N may untap" — Static Orb, Winter Orb's
// land variant; Smoke's "only one creature may untap") are
// // TODO(advanced) — they require a counted-allowance machine that
// the untap loop polls. Filed as Wave 60 follow-up.
//
// NOTE: Frozen Aether is "permanents enter tapped" (a different
// replacement effect, not DontUntap). See destroy-all.ts comment for
// the analogous note on Wrath-of-God-style effects vs regen-shields.
import type { EntityId, ParamValue, StaticAbility, StaticAst } from "@mtg-forge-ts/core";
import type { Restriction } from "../../statics/cant-must-may.js";
import {
  StaticHandler,
  type StaticHandlerCtx,
  normalizeActiveInZones,
  staticHandlerRegistry,
} from "../static-handler.js";
import { buildCardIdPredicate, literalRaw } from "./restriction-helpers.js";

export class DontUntapStaticHandler extends StaticHandler {
  static override readonly mode = "DontUntap" as const;

  override build(ast: StaticAst, ctx: StaticHandlerCtx): StaticAbility {
    const params: Readonly<Record<string, ParamValue>> = ast.params;
    const validRaw = literalRaw(params.ValidCard) ?? "Card.Self";
    const pred = buildCardIdPredicate(validRaw, ctx.sourceCardId, ctx.controllerSeat);

    const restriction: Restriction = {
      sourceStaticId: ctx.staticId,
      kind: "cantUntap",
      // The runtime hands subjectFilter an EntityId | PlayerSeat union;
      // for DontUntap the consumer (untap loop) only ever passes a card
      // id, so the inner buildCardIdPredicate cast is safe.
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
      mode: "DontUntap",
      describe: () => restriction,
    };
  }
}

staticHandlerRegistry.register(DontUntapStaticHandler);
