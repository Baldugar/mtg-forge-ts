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
// Wave 112 closure of the prior advanced tail:
//   - `ValidSA$` is now parsed onto the payload as
//     `saKindMatches(saKind)`. The classifier honors the canonical
//     Forge tags `Spell` / `Activated` / `Triggered` / `Static`
//     (case-insensitive) and falls through to a permissive match for
//     unrecognised tags. The `canAdaptAgain` helper threads the
//     activating SA kind through; consumers that don't yet thread an
//     SA kind through (the Wave 75 default callsite) match all kinds
//     for back-compat.
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
  /**
   * Wave 112 — true iff the activating SA's kind matches `ValidSA$`.
   * Recognised tokens (case-insensitive): "Spell", "Activated",
   * "Triggered", "Static". Unrecognised / missing → permissive (matches
   * any SA kind) for back-compat with consumers that don't thread an SA
   * kind through.
   */
  readonly saKindMatches: (saKind: string | undefined) => boolean;
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
    // Wave 112 — ValidSA$ classifier. Permissive match when omitted or
    // when the consumer doesn't thread an SA kind through.
    const validSaRaw = literalRaw(params.ValidSA);
    const saKindMatches = (saKind: string | undefined): boolean => {
      if (validSaRaw === undefined || validSaRaw.length === 0) return true;
      if (saKind === undefined) return true;
      // Strip qualifiers ("Activated.YouCtrl" → "Activated") and accept
      // a comma-OR list (Forge spelling).
      const tokens = validSaRaw.split(",").map((t) => t.trim().split(".")[0]);
      const lowered = saKind.toLowerCase();
      for (const tok of tokens) {
        if (tok === undefined) continue;
        const t = tok.toLowerCase();
        if (t.length === 0) continue;
        if (t === lowered) return true;
      }
      // Unrecognised tokens fall through permissively (back-compat).
      const recognised = new Set(["spell", "activated", "triggered", "static"]);
      const allRecognised = tokens.every((t) => t !== undefined && recognised.has(t.toLowerCase()));
      return !allRecognised;
    };

    const payload: CanAdaptPayload = {
      kind: "canAdapt",
      cardMatches: (cardId, game) => cardPred(cardId, game),
      saKindMatches,
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
