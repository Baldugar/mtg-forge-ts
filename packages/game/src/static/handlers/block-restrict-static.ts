// SPDX-License-Identifier: GPL-3.0-or-later
// Wave 70.H — BlockRestrict static handler. CR 509.1 — "no more than
// N creatures can block [each combat / for each opponent / for
// CARDNAME]". The global blocker-cap restriction; mirror of
// AttackRestrict (Wave 70.H sibling). Distinct from CantBlock (per-
// creature gate) and CantBlockBy (per-attacker gate).
//
// Forge cards using this (top frequency, ~5 cards in corpus):
//   - Astral Arena               (MaxBlockers$ 1, no defender filter)
//   - Caverns of Despair         (MaxBlockers$ 2, no defender filter)
//   - Dueling Grounds            (MaxBlockers$ 1, no defender filter)
//   - Silent Arbiter             (MaxBlockers$ 1, no defender filter)
//   - Mirri, Weatherlight Duelist
//                              (MaxBlockers$ 1, ValidDefender$ Opponent —
//                               "each opponent can't block with more than
//                                one creature this combat")
//
// DSL examples (top corpus shapes):
//   S:Mode$ BlockRestrict | MaxBlockers$ 1 | Description$ ...
//   S:Mode$ BlockRestrict | MaxBlockers$ 2 | Description$ ...
//   S:Mode$ BlockRestrict | MaxBlockers$ 1 | ValidDefender$ Opponent | Description$ ...
//
// What it does (Forge): the combat-handler's declareBlockers validator
// counts blockers (overall, or filtered per-defender by ValidDefender$
// — "no more than N PER opponent") and rejects on overflow. The MVP
// here treats ValidDefender$ as a scope filter ("only blockers
// declared on the matched defender count") rather than a per-defender
// allotment; matches the Caverns of Despair / Astral Arena / Silent
// Arbiter shape. The Mirri "each opponent can't block with more than
// one" form is captured in payload metadata for the future per-
// defender allotment mode.
//
// Routing: cantMustMay category — already mapped in MODE_TO_CATEGORY.
// Same shape as AttackRestrict: count-based gate, byMode walk.
//
// MVP scope:
//   - MaxBlockers$ <number>            → required positive integer.
//   - ValidDefender$ <player filter>   → optional; when present the cap
//                                        applies only to blockers whose
//                                        declared attacker has a defender
//                                        matching the filter (read at
//                                        the validator site).
// Wave 110 — closes the prior `IsPresent$` TODO(advanced) tail by wiring
// the shared `buildIsPresentGate` helper symmetrically with AttackRestrict.
// The `exceedsBlockerCap` consumer skips statics whose IsPresent$ gate is
// unsatisfied (e.g. "as long as CARDNAME is tapped, no more than N
// creatures can block …").
//
// Wave 111 — closes the prior multi-defender TODO(advanced). The shared
// `buildDefenderFilter` helper splits comma-OR `ValidDefender$` lists into
// a seat-lane and card-lane predicate symmetrically with AttackRestrict
// (`You,Planeswalker.YouCtrl` filters now scope blocker counts against
// either an attacking-you defender OR an attacking-your-planeswalker
// defender). The Mirri-shape "each opponent can't block with more than
// one" form (per-defender allotment — count is summed PER seat rather
// than cumulatively across all matched seats) is now also wired: the
// `perDefenderAllotment` flag on the payload signals to `exceedsBlockerCap`
// that the count must be re-tallied per defender-seat / defender-card,
// matching CR 509.1g semantics for "each <player>" caps.
import type { EntityId, ParamValue, PlayerSeat, StaticAbility, StaticAst } from "@mtg-forge-ts/core";
import type { Game } from "../../game.js";
import {
  StaticHandler,
  type StaticHandlerCtx,
  normalizeActiveInZones,
  staticHandlerRegistry,
} from "../static-handler.js";
import { buildDefenderFilter, buildIsPresentGate, literalRaw } from "./restriction-helpers.js";

export interface BlockRestrictPayload {
  readonly kind: "blockRestrict";
  /** Maximum blockers allowed in one combat (strictly positive). */
  readonly maxBlockers: number;
  /** True iff the matched defender-seat falls under the cap's scope. */
  readonly defenderSeatMatches: (seat: PlayerSeat) => boolean;
  /** True iff the matched defender-card (planeswalker/battle) is in scope. */
  readonly defenderCardMatches: (cardId: EntityId, game: Game) => boolean;
  /** Has any defender filter (false → cap applies to total blockers). */
  readonly hasDefenderFilter: boolean;
  /**
   * Wave 110 — true iff the static's `IsPresent$` sub-conditional gate is
   * currently satisfied. Defaults to always-true when no IsPresent$ is set.
   * The `exceedsBlockerCap` consumer skips statics whose gate is unsatisfied
   * so the cap only fires while the IsPresent$ shape holds.
   */
  readonly isPresentSatisfied: (game: Game) => boolean;
  /**
   * Wave 111 — Mirri-shape per-defender allotment flag. When true, the
   * `exceedsBlockerCap` consumer counts blockers PER defender-seat /
   * defender-card and tests each bucket against `maxBlockers` independently
   * (CR 509.1g semantics for "each opponent can't block with more than N
   * creatures"). When false (the default cap shape) blockers are summed
   * cumulatively across all matched defenders.
   *
   * Triggered by `EachOpponent$ True` on the static, or by the canonical
   * Mirri shape `ValidDefender$ Opponent` (which Forge interprets as
   * per-opponent allotment for blocker caps in CR 509.1g).
   */
  readonly perDefenderAllotment: boolean;
}

export class BlockRestrictStaticHandler extends StaticHandler {
  static override readonly mode = "BlockRestrict" as const;

  override build(ast: StaticAst, ctx: StaticHandlerCtx): StaticAbility {
    const params: Readonly<Record<string, ParamValue>> = ast.params;
    const maxBlockersRaw = literalRaw(params.MaxBlockers);
    const maxBlockers = parseBlockerCount(maxBlockersRaw);
    const validDefenderRaw = literalRaw(params.ValidDefender);

    const hasDefenderFilter = validDefenderRaw !== undefined && validDefenderRaw.length > 0;
    // Wave 111 — comma-OR multi-defender support. Symmetric with
    // AttackRestrict.
    const defenderFilter = buildDefenderFilter(
      hasDefenderFilter ? validDefenderRaw : undefined,
      ctx.sourceCardId,
      ctx.controllerSeat,
    );
    const seatPred = defenderFilter.seatMatches;
    const cardDefenderPred = defenderFilter.cardMatches;
    // Wave 111 — Mirri-shape per-defender allotment. Forge encodes this
    // either via `EachOpponent$ True` (explicit) or via the canonical
    // `ValidDefender$ Opponent` BlockRestrict shape (where CR 509.1g's
    // "each opponent" interpretation applies). When the static's
    // ValidDefender$ literal is exactly `Opponent` (or one of its
    // canonical aliases) without other tokens, we treat it as
    // per-opponent allotment.
    const eachOpponentRaw = literalRaw(params.EachOpponent);
    const eachOpponentExplicit = eachOpponentRaw?.toLowerCase() === "true";
    const isOpponentOnlyFilter =
      hasDefenderFilter &&
      validDefenderRaw !== undefined &&
      (() => {
        const tokens = validDefenderRaw
          .split(",")
          .map((t) => t.trim())
          .filter((t) => t.length > 0);
        if (tokens.length !== 1) return false;
        const t = tokens[0];
        return (
          t === "Opponent" || t === "Player.Opponent" || t === "Player.OppCtrl" || t === "Player.NonActive"
        );
      })();
    const perDefenderAllotment = eachOpponentExplicit || isOpponentOnlyFilter;

    const presentGate = buildIsPresentGate(params, {
      sourceCardId: ctx.sourceCardId,
      controllerSeat: ctx.controllerSeat,
    });

    const payload: BlockRestrictPayload = {
      kind: "blockRestrict",
      maxBlockers,
      defenderSeatMatches: (seat) => seatPred(seat),
      defenderCardMatches: (cardId, game) => cardDefenderPred(cardId, game),
      hasDefenderFilter,
      isPresentSatisfied: (game) => presentGate(game),
      perDefenderAllotment,
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
      mode: "BlockRestrict",
      describe: () => payload,
    };
  }
}

const parseBlockerCount = (raw: string | undefined): number => {
  if (raw === undefined) return Number.POSITIVE_INFINITY;
  const n = Number.parseInt(raw, 10);
  if (Number.isFinite(n) && n > 0) return n;
  return Number.POSITIVE_INFINITY;
};

staticHandlerRegistry.register(BlockRestrictStaticHandler);
