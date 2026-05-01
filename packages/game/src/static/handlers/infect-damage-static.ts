// SPDX-License-Identifier: GPL-3.0-or-later
// Wave 77 — InfectDamage static handler. CR 702.90 (Infect) — static
// form. Forge's StaticAbilityInfectDamage.java equivalent.
//
// Wave 36 wired Infect at the keyword level (K:Infect — the source's
// damage to creatures is dealt as -1/-1 counters AND damage to players
// is dealt as poison counters). InfectDamage is the static-form rewriter:
// matched cards' damage gets the same dual redirect even when the source
// itself doesn't carry the K:Infect keyword. Used by:
//   - "Damage from <filter> sources is dealt as Infect" cards (rare
//     global Infect-grant statics — distinct from a per-card keyword
//     grant).
//   - Static form for a small handful of cards that grant Infect-shape
//     damage rewriting via a S: line rather than a card-side keyword.
//
// DSL (corpus):
//   S:Mode$ InfectDamage | ValidCard$ <filter> | Description$ ...
//
// What it does (Forge): consulted at the damage-application call site.
// When ValidCard$ matches the damage source:
//   - Damage to creatures → -1/-1 counters (like K:Wither).
//   - Damage to players   → poison counters (CR 702.90b).
// The static OR-combines with the K:Infect keyword check — either path
// triggers both redirects.
//
// Routing: ruleChanging per MODE_TO_CATEGORY (overrides CR 119
// damage application + CR 702.90b poison-counter substitution).
//
// MVP scope:
//   - ValidCard$ <filter>      → cardMatchesFilter (Wave 32 grammar).
//   - Card.Self short-circuit  → sourceCardId === cardId.
// TODO(advanced):
//   - ExceptionType$ <filter>  (carve-out for specific damage types);
//     not yet observed in the corpus for InfectDamage.
import type { EntityId, ParamValue, StaticAbility, StaticAst } from "@mtg-forge-ts/core";
import type { Game } from "../../game.js";
import {
  StaticHandler,
  type StaticHandlerCtx,
  normalizeActiveInZones,
  staticHandlerRegistry,
} from "../static-handler.js";
import { buildCardIdPredicate, literalRaw } from "./restriction-helpers.js";

export interface InfectDamagePayload {
  readonly kind: "infectDamage";
  readonly cardMatches: (cardId: EntityId, game: Game) => boolean;
}

export class InfectDamageStaticHandler extends StaticHandler {
  static override readonly mode = "InfectDamage" as const;

  override build(ast: StaticAst, ctx: StaticHandlerCtx): StaticAbility {
    const params: Readonly<Record<string, ParamValue>> = ast.params;
    const validCardRaw = literalRaw(params.ValidCard) ?? "Card.Self";
    const cardPred = buildCardIdPredicate(validCardRaw, ctx.sourceCardId, ctx.controllerSeat);

    const payload: InfectDamagePayload = {
      kind: "infectDamage",
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
      mode: "InfectDamage",
      describe: () => payload,
    };
  }
}

staticHandlerRegistry.register(InfectDamageStaticHandler);
