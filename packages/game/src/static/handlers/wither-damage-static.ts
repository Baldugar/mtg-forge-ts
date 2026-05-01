// SPDX-License-Identifier: GPL-3.0-or-later
// Wave 77 — WitherDamage static handler. CR 702.79 (Wither) — static
// form. Forge's StaticAbilityWitherDamage.java equivalent.
//
// Wave 36 wired Wither at the keyword level (K:Wither — the source's
// damage to creatures is dealt as -1/-1 counters instead). WitherDamage
// is the static-form rewriter: matched cards' damage to creatures is
// rewritten to -1/-1 counters even when the source itself doesn't carry
// the K:Wither keyword. Used by:
//   - "Damage from <filter> sources is dealt as -1/-1 counters" cards
//     (rare global Wither-grant statics — distinct from a per-card
//     keyword grant).
//   - Static form for a small handful of cards that grant Wither-shape
//     damage rewriting via a S: line rather than a card-side keyword.
//
// DSL (corpus):
//   S:Mode$ WitherDamage | ValidCard$ <filter> | Description$ ...
//
// What it does (Forge): consulted at the damage-application call site.
// When ValidCard$ matches the damage source, damage to creatures
// becomes -1/-1 counter damage (mimics K:Wither). The static
// OR-combines with the K:Wither keyword check — either path triggers
// the redirect.
//
// Routing: ruleChanging per MODE_TO_CATEGORY (overrides CR 119
// damage application).
//
// MVP scope:
//   - ValidCard$ <filter>      → cardMatchesFilter (Wave 32 grammar).
//   - Card.Self short-circuit  → sourceCardId === cardId.
// TODO(advanced):
//   - ExceptionType$ <filter>  (carve-out for specific damage types);
//     not yet observed in the corpus for WitherDamage.
import type { EntityId, ParamValue, StaticAbility, StaticAst } from "@mtg-forge-ts/core";
import type { Game } from "../../game.js";
import {
  StaticHandler,
  type StaticHandlerCtx,
  normalizeActiveInZones,
  staticHandlerRegistry,
} from "../static-handler.js";
import { buildCardIdPredicate, literalRaw } from "./restriction-helpers.js";

export interface WitherDamagePayload {
  readonly kind: "witherDamage";
  readonly cardMatches: (cardId: EntityId, game: Game) => boolean;
}

export class WitherDamageStaticHandler extends StaticHandler {
  static override readonly mode = "WitherDamage" as const;

  override build(ast: StaticAst, ctx: StaticHandlerCtx): StaticAbility {
    const params: Readonly<Record<string, ParamValue>> = ast.params;
    const validCardRaw = literalRaw(params.ValidCard) ?? "Card.Self";
    const cardPred = buildCardIdPredicate(validCardRaw, ctx.sourceCardId, ctx.controllerSeat);

    const payload: WitherDamagePayload = {
      kind: "witherDamage",
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
      mode: "WitherDamage",
      describe: () => payload,
    };
  }
}

staticHandlerRegistry.register(WitherDamageStaticHandler);
