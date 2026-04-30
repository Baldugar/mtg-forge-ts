// SPDX-License-Identifier: GPL-3.0-or-later
// Wave 70.H — AttackRestrict static handler. CR 506.5 — "no more than
// N creatures can attack [each combat / a player / CARDNAME]". The
// global combat-cap restriction; distinct from CantAttack (per-creature
// gate) and from CantAttackUnless (per-creature unless-cost gate).
//
// Forge cards using this (top frequency, ~8 cards in corpus):
//   - Astral Arena               (MaxAttackers$ 1, no defender filter)
//   - Caverns of Despair         (MaxAttackers$ 2, no defender filter)
//   - Crawlspace                 (MaxAttackers$ 2, ValidDefender$ You)
//   - Dueling Grounds            (MaxAttackers$ 1, no defender filter)
//   - Judoon Enforcers           (MaxAttackers$ 1, ValidDefender$ You)
//   - Mirri, Weatherlight Duelist (conditional MaxAttackers$ 1, You)
//   - Silent Arbiter             (MaxAttackers$ 1, no defender filter)
//   - The Eternal Wanderer       (MaxAttackers$ 1, ValidDefender$ Card.Self)
//
// DSL examples (top corpus shapes):
//   S:Mode$ AttackRestrict | MaxAttackers$ 1 | Description$ ...
//   S:Mode$ AttackRestrict | MaxAttackers$ 2 | ValidDefender$ You | Description$ ...
//   S:Mode$ AttackRestrict | MaxAttackers$ 1 | ValidDefender$ Card.Self | Description$ ...
//
// What it does (Forge): the combat-handler's declareAttackers
// validator counts attackers (overall, or filtered by ValidDefender$)
// and rejects the declaration when the count exceeds MaxAttackers$.
// On a violation: IllegalDecisionError (mirror of the CantAttack /
// decayed-blocker rejection paths).
//
// Routing: cantMustMay category — already mapped in MODE_TO_CATEGORY.
// The describe() returns the raw payload (NOT a Restriction wrapper)
// because this gate is COUNT-based not subject-based: the
// gatherRestrictions sweep doesn't fit. The combat-handler's
// validateAttackerCount helper walks byMode("AttackRestrict") directly.
//
// MVP scope:
//   - MaxAttackers$ <number>           → required; non-numeric → conservative
//                                        skip (Forge always supplies a number).
//   - ValidDefender$ <player/PW/card>  → optional; when present, only
//                                        attackers declared against a
//                                        matching defender count toward
//                                        the cap. Recognises:
//                                          - "You"      → controller's seat
//                                          - "Opponent" → non-controller seat
//                                          - "Card.Self" → the source card
//                                            (planeswalker-self defender)
//                                          - any other literal → cardMatchesFilter
//                                            against the declared defender
//                                            (when defender is a planeswalker
//                                            or battle).
// TODO(advanced):
//   - IsPresent$ conditional gating (Mirri-shape "as long as CARDNAME is
//     tapped, …" — Wave 70.H MVP treats the static as always-active when
//     registered; the Mirri form lives via Continuous AddStaticAbility$
//     on the AbilityFactory side).
//   - Multi-defender filter ("ValidDefender$ You,Planeswalker.YouCtrl")
//     accepted as a single literal today.
import type { EntityId, ParamValue, PlayerSeat, StaticAbility, StaticAst } from "@mtg-forge-ts/core";
import type { Game } from "../../game.js";
import {
  StaticHandler,
  type StaticHandlerCtx,
  normalizeActiveInZones,
  staticHandlerRegistry,
} from "../static-handler.js";
import { buildCardIdPredicate, buildPlayerPredicate, literalRaw } from "./restriction-helpers.js";

export interface AttackRestrictPayload {
  readonly kind: "attackRestrict";
  /** Maximum attackers allowed in one combat. Strictly positive. */
  readonly maxAttackers: number;
  /**
   * True iff the declared player-defender (seat) matches ValidDefender$.
   * Always-true when no ValidDefender$ filter is set (= cap applies to
   * total attackers regardless of target).
   */
  readonly defenderSeatMatches: (seat: PlayerSeat) => boolean;
  /**
   * True iff the declared card-defender (planeswalker / battle / Card.Self)
   * matches ValidDefender$. Always-true when no filter is set.
   */
  readonly defenderCardMatches: (cardId: EntityId, game: Game) => boolean;
  /** Has any defender filter at all (false → unconditional cap). */
  readonly hasDefenderFilter: boolean;
}

export class AttackRestrictStaticHandler extends StaticHandler {
  static override readonly mode = "AttackRestrict" as const;

  override build(ast: StaticAst, ctx: StaticHandlerCtx): StaticAbility {
    const params: Readonly<Record<string, ParamValue>> = ast.params;
    const maxAttackersRaw = literalRaw(params.MaxAttackers);
    const maxAttackers = parseAttackerCount(maxAttackersRaw);
    const validDefenderRaw = literalRaw(params.ValidDefender);

    const hasDefenderFilter = validDefenderRaw !== undefined && validDefenderRaw.length > 0;
    const seatPred = hasDefenderFilter
      ? buildPlayerPredicate(extractSeatToken(validDefenderRaw), ctx.controllerSeat)
      : (_seat: PlayerSeat): boolean => true;
    const cardDefenderPred = hasDefenderFilter
      ? buildCardIdPredicate(validDefenderRaw, ctx.sourceCardId, ctx.controllerSeat)
      : (_cardId: EntityId, _game: Game): boolean => true;

    const payload: AttackRestrictPayload = {
      kind: "attackRestrict",
      maxAttackers,
      defenderSeatMatches: (seat) => seatPred(seat),
      defenderCardMatches: (cardId, game) => cardDefenderPred(cardId, game),
      hasDefenderFilter,
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
      mode: "AttackRestrict",
      describe: () => payload,
    };
  }
}

/**
 * Parse the MaxAttackers$ value. Forge always supplies a positive
 * integer literal; non-numeric / missing falls back to a permissive
 * Number.POSITIVE_INFINITY (effectively no cap, so the handler
 * harmlessly registers but does not constrain — defensive default
 * matching the Wave 50 MinMaxBlocker pattern).
 */
const parseAttackerCount = (raw: string | undefined): number => {
  if (raw === undefined) return Number.POSITIVE_INFINITY;
  const n = Number.parseInt(raw, 10);
  if (Number.isFinite(n) && n > 0) return n;
  return Number.POSITIVE_INFINITY;
};

/**
 * Extract the seat-typed token from a comma-separated ValidDefender$
 * filter. Recognises "Opponent" / "You" / "Any" / "Player". Returns
 * undefined (= match any seat) when no recognisable token is present.
 */
const extractSeatToken = (raw: string | undefined): string | undefined => {
  if (raw === undefined || raw.length === 0) return undefined;
  for (const part of raw.split(",")) {
    const t = part.trim();
    if (t === "Opponent" || t === "You" || t === "Any" || t === "Player") return t;
  }
  return undefined;
};

staticHandlerRegistry.register(AttackRestrictStaticHandler);
