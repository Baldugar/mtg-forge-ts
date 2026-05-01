// SPDX-License-Identifier: GPL-3.0-or-later
// Wave 70.G — CanAttackIfHaste static handler. CR 302.6 / 506.5 —
// "<creatures> can attack as though they had haste". Positive override
// of summoning sickness for matched attackers / matched defenders.
//
// Forge cards using this (top frequency, ~28 cards in corpus):
//   - Glorybringer / Combat Celebrant analogues (exert / haste-grant
//                                                shapes that bypass
//                                                summoning sickness)
//   - Frenzied Saddlebrute       ("All creatures can attack your
//                                  opponents and planeswalkers your
//                                  opponents control as though those
//                                  creatures had haste.")
//   - Instill Energy             ("Enchanted creature can attack as
//                                  though it had haste.")
//   - Hooded Brawler / Khenra Scrapper — Exert-creature aura shape.
//   - Aggressive Mining / Dauntless Bodyguard — pseudo-haste enchantments.
//
// DSL examples (top corpus shapes):
//   S:Mode$ CanAttackIfHaste | ValidCard$ Creature.EnchantedBy
//   S:Mode$ CanAttackIfHaste | ValidTarget$ Opponent,Planeswalker.OppCtrl
//   S:Mode$ CanAttackIfHaste | ValidCard$ Card.Self
//
// What it does (Forge): the attack-declaration validator asks
// `canAttackAsIfHaste(game, attackerId, defender)` BEFORE rejecting an
// attacker for summoning sickness. On match, the rejection is
// suppressed: the matched creature attacks the matched defender as
// though it had haste.
//
// Routing: cantMustMay category — already mapped in MODE_TO_CATEGORY
// (positive permission gate, registry-walk shape). The describe()
// payload exposes both predicates; the gate consumer
// (canAttackAsIfHaste in wave70g-combat-gates.ts) walks the registry
// per-query.
//
// MVP scope:
//   - ValidCard$ <filter>     — Wave 32 grammar via cardMatchesFilter.
//   - ValidTarget$ <filter>   — defender filter; player/PW match
//                                relaxes the haste rejection only when
//                                the declared defender matches. Empty
//                                / undefined → match any defender.
// Wave 112 closure of the prior advanced tail:
//   - `Cost$ <Forge cost string>` — the "may attack as though haste if
//     controller pays {N}" form (Exert-cost cousin) is now parsed onto
//     the payload as `costText` so the future attack-declaration cost-
//     payment dialog (the Wave 70.D CantAttackUnless follow-up) can
//     read it without re-parsing the static. The MVP gate continues to
//     fire unconditionally on a card-match for back-compat — until the
//     cost-payment dialog lands, the cost is treated as "always paid".
import type { EntityId, ParamValue, PlayerSeat, StaticAbility, StaticAst } from "@mtg-forge-ts/core";
import type { Game } from "../../game.js";
import {
  StaticHandler,
  type StaticHandlerCtx,
  normalizeActiveInZones,
  staticHandlerRegistry,
} from "../static-handler.js";
import { buildCardIdPredicate, buildPlayerPredicate, literalRaw } from "./restriction-helpers.js";

export interface CanAttackIfHastePayload {
  readonly kind: "canAttackIfHaste";
  /** True iff the candidate attacker matches ValidCard$. */
  readonly cardMatches: (cardId: EntityId, game: Game) => boolean;
  /** True iff the declared player-defender matches ValidTarget$ (player-shape). */
  readonly defenderSeatMatches: (seat: PlayerSeat) => boolean;
  /** True iff the declared planeswalker-defender (a card id) matches ValidTarget$. */
  readonly defenderCardMatches: (cardId: EntityId, game: Game) => boolean;
  /**
   * Wave 112 — Forge `Cost$ <cost string>` (e.g. "1", "Exert<1/CARDNAME>").
   * undefined when omitted (the canonical free-of-charge haste shape).
   * The future cost-payment dialog at attack-declaration time reads this
   * field; the MVP gate fires unconditionally on a card-match.
   */
  readonly costText: string | undefined;
}

export class CanAttackIfHasteStaticHandler extends StaticHandler {
  static override readonly mode = "CanAttackIfHaste" as const;

  override build(ast: StaticAst, ctx: StaticHandlerCtx): StaticAbility {
    const params: Readonly<Record<string, ParamValue>> = ast.params;
    const validCardRaw = literalRaw(params.ValidCard) ?? "Card.Self";
    const validTargetRaw = literalRaw(params.ValidTarget);

    const cardPred = buildCardIdPredicate(validCardRaw, ctx.sourceCardId, ctx.controllerSeat);
    // ValidTarget$ semantically applies to BOTH player seats and PW card
    // ids; the corpus shape mixes them ("Opponent,Planeswalker.OppCtrl").
    // For MVP we route the seat filter through buildPlayerPredicate (which
    // recognises You/Opponent/Any) and the card filter through
    // buildCardIdPredicate (which falls back to cardMatchesFilter for
    // arbitrary planeswalker filters). Empty / undefined → match anything.
    const seatPred = buildPlayerPredicate(extractSeatToken(validTargetRaw), ctx.controllerSeat);
    const cardDefenderPred =
      validTargetRaw === undefined || validTargetRaw.length === 0
        ? () => true
        : buildCardIdPredicate(validTargetRaw, ctx.sourceCardId, ctx.controllerSeat);

    // Wave 112 — Cost$ surface for the future cost-payment dialog.
    const costText = literalRaw(params.Cost);

    const payload: CanAttackIfHastePayload = {
      kind: "canAttackIfHaste",
      cardMatches: (cardId, game) => cardPred(cardId, game),
      defenderSeatMatches: (seat) => seatPred(seat),
      defenderCardMatches: (cardId, game) => cardDefenderPred(cardId, game),
      costText,
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
      mode: "CanAttackIfHaste",
      describe: () => payload,
    };
  }
}

/**
 * Extract the seat-typed token from a comma-separated ValidTarget$ filter.
 * Recognises "Opponent" / "You" / "Any" / "Player". Returns undefined
 * (= match any seat) when no recognisable token is present (e.g. when
 * the filter is purely card-shape like "Planeswalker.OppCtrl").
 */
const extractSeatToken = (raw: string | undefined): string | undefined => {
  if (raw === undefined || raw.length === 0) return undefined;
  for (const part of raw.split(",")) {
    const t = part.trim();
    if (t === "Opponent" || t === "You" || t === "Any" || t === "Player") return t;
  }
  return undefined;
};

staticHandlerRegistry.register(CanAttackIfHasteStaticHandler);
