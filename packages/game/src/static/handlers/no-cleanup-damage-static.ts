// SPDX-License-Identifier: GPL-3.0-or-later
// Wave 70.I — NoCleanupDamage static handler. CR 514.2 — damage marked on
// a creature does NOT heal at end of turn (during cleanup) for cards
// matching ValidCard$.
//
// Forge cards using this:
//   - Old-school nostalgic cards from Mercadian Masques / Innistrad with
//     "permanent damage" themes
//   - Sulfuric Vortex synergies   (the canonical Sulfuric Vortex itself
//                                   uses CantGainLife, but neighbors in
//                                   the "damage stays" archetype use
//                                   NoCleanupDamage to keep marked damage
//                                   between turns)
//   - Boon Reflection-style anti-heal corner cases
//   - Characteristic-defining "damage stays through cleanup" abilities
//
// DSL:
//   S:Mode$ NoCleanupDamage | ValidCard$ Card.Self      | Description$ ...
//   S:Mode$ NoCleanupDamage | ValidCard$ Creature.YouCtrl | Description$ ...
//
// What it does (Forge): the matched creature's accumulated marked damage
// (CR 119.10 — "damage marked on a creature") does NOT clear during the
// cleanup step (CR 514.2). The default cleanup-step turn-based action
// removes all marked damage from every creature; this static suppresses
// that removal for cards matching the filter. Damage already on the
// creature remains until next combat (or until removed by another
// effect, e.g. regeneration / heal triggers / leaving the battlefield).
//
// Routing: ruleChanging category — already mapped in MODE_TO_CATEGORY.
// The describe() payload exposes `cardMatches`; the gate consumer
// (clearsDamageInCleanup in wave70i-loyalty-gates.ts) walks the registry
// per-query.
//
// MVP scope:
//   - ValidCard$ <filter> — Wave 32 grammar via cardMatchesFilter.
//   - Card.Self short-circuit honored.
// TODO(advanced):
//   - Source-conditional sub-filters (NoCleanupDamageFromSource$ X).
import type { EntityId, ParamValue, StaticAbility, StaticAst } from "@mtg-forge-ts/core";
import type { Game } from "../../game.js";
import {
  StaticHandler,
  type StaticHandlerCtx,
  normalizeActiveInZones,
  staticHandlerRegistry,
} from "../static-handler.js";
import { buildCardIdPredicate, literalRaw } from "./restriction-helpers.js";

export interface NoCleanupDamagePayload {
  readonly kind: "noCleanupDamage";
  readonly cardMatches: (cardId: EntityId, game: Game) => boolean;
}

export class NoCleanupDamageStaticHandler extends StaticHandler {
  static override readonly mode = "NoCleanupDamage" as const;

  override build(ast: StaticAst, ctx: StaticHandlerCtx): StaticAbility {
    const params: Readonly<Record<string, ParamValue>> = ast.params;
    const validCardRaw = literalRaw(params.ValidCard) ?? "Card.Self";
    const cardPred = buildCardIdPredicate(validCardRaw, ctx.sourceCardId, ctx.controllerSeat);

    const payload: NoCleanupDamagePayload = {
      kind: "noCleanupDamage",
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
      category: "ruleChanging",
      mode: "NoCleanupDamage",
      describe: () => payload,
    };
  }
}

staticHandlerRegistry.register(NoCleanupDamageStaticHandler);
