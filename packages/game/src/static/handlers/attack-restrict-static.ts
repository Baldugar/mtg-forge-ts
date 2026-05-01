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
// Wave 110 — closes the prior `IsPresent$` TODO(advanced) tail. The shared
// `buildIsPresentGate` helper now wires the Mirri-shape "as long as <filter>
// is present" sub-conditional into the AttackRestrict gate; the
// `exceedsAttackerCap` consumer skips statics whose gate is unsatisfied at
// query time so the cap only activates while the IsPresent$ board state
// holds (canonical Forge "as long as …" semantics).
//
// Wave 111 — closes the prior multi-defender TODO(advanced). The shared
// `buildDefenderFilter` helper now splits comma-OR `ValidDefender$` lists
// into a seat-lane (You / Opponent / Player.YouCtrl / etc.) and a
// card-lane (Card.Self / Planeswalker.YouCtrl / Battle.* / etc.); the
// returned predicate fires true on either lane match. Mirri-shape
// "ValidDefender$ You,Planeswalker.YouCtrl" caps now scope the count
// against either an attacking-you player OR an attacking-your-planeswalker
// card, matching Forge's `ValidDefender$` OR grammar.
import type { EntityId, ParamValue, PlayerSeat, StaticAbility, StaticAst } from "@mtg-forge-ts/core";
import type { Game } from "../../game.js";
import {
  StaticHandler,
  type StaticHandlerCtx,
  normalizeActiveInZones,
  staticHandlerRegistry,
} from "../static-handler.js";
import { buildDefenderFilter, buildIsPresentGate, literalRaw } from "./restriction-helpers.js";

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
  /**
   * Wave 110 — true iff the static's `IsPresent$` sub-conditional gate is
   * currently satisfied. Defaults to always-true when no IsPresent$ is set.
   * Re-evaluated per query so mid-turn board-state changes (Mirri tapping/
   * untapping) gate the cap correctly. The `exceedsAttackerCap` consumer
   * skips statics whose gate is unsatisfied so the cap only fires while
   * the IsPresent$ shape holds.
   */
  readonly isPresentSatisfied: (game: Game) => boolean;
}

export class AttackRestrictStaticHandler extends StaticHandler {
  static override readonly mode = "AttackRestrict" as const;

  override build(ast: StaticAst, ctx: StaticHandlerCtx): StaticAbility {
    const params: Readonly<Record<string, ParamValue>> = ast.params;
    const maxAttackersRaw = literalRaw(params.MaxAttackers);
    const maxAttackers = parseAttackerCount(maxAttackersRaw);
    const validDefenderRaw = literalRaw(params.ValidDefender);

    const hasDefenderFilter = validDefenderRaw !== undefined && validDefenderRaw.length > 0;
    // Wave 111 — comma-OR multi-defender support. The shared filter splits
    // tokens into seat-lane and card-lane predicates; either-lane match
    // returns true (Forge `ValidDefender$` is OR-shaped across commas).
    const defenderFilter = buildDefenderFilter(
      hasDefenderFilter ? validDefenderRaw : undefined,
      ctx.sourceCardId,
      ctx.controllerSeat,
    );
    const seatPred = defenderFilter.seatMatches;
    const cardDefenderPred = defenderFilter.cardMatches;

    const presentGate = buildIsPresentGate(params, {
      sourceCardId: ctx.sourceCardId,
      controllerSeat: ctx.controllerSeat,
    });

    const payload: AttackRestrictPayload = {
      kind: "attackRestrict",
      maxAttackers,
      defenderSeatMatches: (seat) => seatPred(seat),
      defenderCardMatches: (cardId, game) => cardDefenderPred(cardId, game),
      hasDefenderFilter,
      isPresentSatisfied: (game) => presentGate(game),
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

staticHandlerRegistry.register(AttackRestrictStaticHandler);
