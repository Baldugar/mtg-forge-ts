// SPDX-License-Identifier: GPL-3.0-or-later
// Wave 75 — IgnoreShroud static handler. CR 702.18 carve-out — "the
// matched activator may target the matched entity as though it didn't
// have shroud". Forge's StaticAbilityIgnoreHexproofShroud.java
// equivalent (the SHROUD branch).
//
// Forge cards using this:
//   - Autumn Willow (HML) — "{G}: Until end of turn, Autumn Willow
//                              can be the target of spells and
//                              abilities controlled by target player
//                              as though it didn't have shroud."
//                            Synthesizes a temporary AB$ Effect with
//                            StaticAbilities$ STLoseAB.
//
// DSL (corpus):
//   S:Mode$ IgnoreShroud | Activator$ Player.IsRemembered
//          | ValidEntity$ Card.EffectSource
//          | Description$ ...
//
// What it does (Forge): consulted at the target-validation site.
// When the would-be target has shroud (Forge: `card has Keyword
// SHROUD`) but the activator matches Activator$ (and the would-be
// target itself matches the optional ValidEntity$ filter), shroud is
// bypassed for that pairing.
//
// Routing: ruleChanging per MODE_TO_CATEGORY (Forge canonical
// category; it overrides the canonical shroud rule). MVP-mode here
// uses the registry-walk pattern (Wave 70.D-J / 70.K) —
// `ignoresShroud(game, activatorSeat, targetId?)` consults the
// active gates per query and returns true if any matching static is
// in force.
//
// MVP scope:
//   - Activator$ <filter>      → buildPlayerPredicate (You /
//                                  Opponent / Any / Player). Forge's
//                                  full grammar accepts
//                                  Player.IsRemembered (resolved
//                                  per-static against the source
//                                  card's remembered list) — for the
//                                  MVP we collapse this to "any
//                                  player" since the remembered-
//                                  player slot is set per-Effect and
//                                  the gate is consulted with the
//                                  resolved activator seat.
//   - ValidEntity$ <filter>    → buildCardIdPredicate
//                                  (Card.EffectSource / Card.Self /
//                                  Wave 32 grammar). Optional;
//                                  undefined matches every entity.
import type { EntityId, ParamValue, PlayerSeat, StaticAbility, StaticAst } from "@mtg-forge-ts/core";
import type { Game } from "../../game.js";
import {
  StaticHandler,
  type StaticHandlerCtx,
  normalizeActiveInZones,
  staticHandlerRegistry,
} from "../static-handler.js";
import { buildCardIdPredicate, buildPlayerPredicate, literalRaw } from "./restriction-helpers.js";

/**
 * Read-side payload. The match logic is AND across both predicates:
 *   - activatorMatches  → activator seat passes Activator$.
 *   - entityMatches     → would-be target card passes ValidEntity$.
 * Each predicate independently defaults to "always match" when its
 * filter is undefined.
 */
export interface IgnoreShroudPayload {
  readonly kind: "ignoreShroud";
  /** True iff `activatorSeat` matches Activator$. */
  readonly activatorMatches: (activatorSeat: PlayerSeat) => boolean;
  /** True iff `cardId` (would-be target) matches ValidEntity$. */
  readonly entityMatches: (cardId: EntityId, game: Game) => boolean;
}

export class IgnoreShroudStaticHandler extends StaticHandler {
  static override readonly mode = "IgnoreShroud" as const;

  override build(ast: StaticAst, ctx: StaticHandlerCtx): StaticAbility {
    const params: Readonly<Record<string, ParamValue>> = ast.params;
    const activatorRaw = literalRaw(params.Activator);
    const validEntityRaw = literalRaw(params.ValidEntity);

    const activatorPred = buildPlayerPredicate(activatorRaw, ctx.controllerSeat);
    // The "Card.EffectSource" form resolves to the static's source
    // card (the Effect-card wrapping the temporary static). Map it
    // to Card.Self so buildCardIdPredicate resolves against
    // ctx.sourceCardId, which is exactly the Effect-source card id.
    const entityFilter = validEntityRaw === "Card.EffectSource" ? "Card.Self" : validEntityRaw;
    const entityPred =
      entityFilter === undefined
        ? () => true
        : buildCardIdPredicate(entityFilter, ctx.sourceCardId, ctx.controllerSeat);

    const payload: IgnoreShroudPayload = {
      kind: "ignoreShroud",
      activatorMatches: (seat) => activatorPred(seat),
      entityMatches: (cardId, game) => entityPred(cardId, game),
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
      mode: "IgnoreShroud",
      describe: () => payload,
    };
  }
}

staticHandlerRegistry.register(IgnoreShroudStaticHandler);
