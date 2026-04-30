// SPDX-License-Identifier: GPL-3.0-or-later
// Wave 75 — CanAdapt static handler. CR 702.139a carve-out — "the
// creature adapts as though it had no +1/+1 counters on it". Forge's
// StaticAbilityAdapt.java equivalent.
//
// Forge cards using this:
//   - Biomancer's Familiar (RNA) — "{T}: The next time target creature
//                                    adapts this turn, it adapts as
//                                    though it had no +1/+1 counters
//                                    on it." Synthesizes a temporary
//                                    static via AB$ Effect with
//                                    StaticAbilities$ StaticAllowAdapt.
//
// DSL (corpus):
//   S:Mode$ CanAdapt | ValidCard$ Card.IsRemembered | Description$ ...
//
// What it does (Forge): consulted at AdaptEffect.resolve. The
// canonical CR 702.139a "no +1/+1 counters" precondition becomes a
// no-op for matched creatures — the creature adapts even with
// counters already on it.
//
// Routing: ruleChanging per MODE_TO_CATEGORY (Forge canonical
// category; it overrides the canonical adapt rule). MVP-mode here
// uses the registry-walk pattern (Wave 70.D-J) — `canAdaptAgain(
// game, cardId)` consults the active gates per query and returns
// true if any matching static is in force.
//
// MVP scope:
//   - ValidCard$ <filter> via buildCardIdPredicate (Card.Self,
//     Card.IsRemembered, Wave 50/32 grammar).
// TODO(advanced):
//   - ValidSA$ Spell sub-shape (the ValidSA classifier) — Forge's
//     full filter accepts an SA-kind dimension; the MVP doesn't
//     distinguish spell vs activated as a filter dimension.
import type { EntityId, ParamValue, StaticAbility, StaticAst } from "@mtg-forge-ts/core";
import type { Game } from "../../game.js";
import {
  StaticHandler,
  type StaticHandlerCtx,
  normalizeActiveInZones,
  staticHandlerRegistry,
} from "../static-handler.js";
import { buildCardIdPredicate, literalRaw } from "./restriction-helpers.js";

/**
 * Read-side payload. The match logic uses the per-card predicate
 * (defaults to "always match" when ValidCard$ is undefined).
 */
export interface CanAdaptPayload {
  readonly kind: "canAdapt";
  /** True iff `cardId` (the adapting creature) matches ValidCard$. */
  readonly cardMatches: (cardId: EntityId, game: Game) => boolean;
}

export class CanAdaptStaticHandler extends StaticHandler {
  static override readonly mode = "CanAdapt" as const;

  override build(ast: StaticAst, ctx: StaticHandlerCtx): StaticAbility {
    const params: Readonly<Record<string, ParamValue>> = ast.params;
    const validCardRaw = literalRaw(params.ValidCard);
    const cardPred =
      validCardRaw === undefined
        ? () => true
        : buildCardIdPredicate(validCardRaw, ctx.sourceCardId, ctx.controllerSeat);

    const payload: CanAdaptPayload = {
      kind: "canAdapt",
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
      mode: "CanAdapt",
      describe: () => payload,
    };
  }
}

staticHandlerRegistry.register(CanAdaptStaticHandler);
