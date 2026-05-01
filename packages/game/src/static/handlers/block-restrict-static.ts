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
// TODO(advanced):
//   - Per-defender allotment ("each opponent can't block with more than
//     one" — needs per-seat counting at validation time, not a single
//     cumulative cap).
//   - Multi-defender filter union accepted as one literal today.
import type { EntityId, ParamValue, PlayerSeat, StaticAbility, StaticAst } from "@mtg-forge-ts/core";
import type { Game } from "../../game.js";
import {
  StaticHandler,
  type StaticHandlerCtx,
  normalizeActiveInZones,
  staticHandlerRegistry,
} from "../static-handler.js";
import {
  buildCardIdPredicate,
  buildIsPresentGate,
  buildPlayerPredicate,
  literalRaw,
} from "./restriction-helpers.js";

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
}

export class BlockRestrictStaticHandler extends StaticHandler {
  static override readonly mode = "BlockRestrict" as const;

  override build(ast: StaticAst, ctx: StaticHandlerCtx): StaticAbility {
    const params: Readonly<Record<string, ParamValue>> = ast.params;
    const maxBlockersRaw = literalRaw(params.MaxBlockers);
    const maxBlockers = parseBlockerCount(maxBlockersRaw);
    const validDefenderRaw = literalRaw(params.ValidDefender);

    const hasDefenderFilter = validDefenderRaw !== undefined && validDefenderRaw.length > 0;
    const seatPred = hasDefenderFilter
      ? buildPlayerPredicate(extractSeatToken(validDefenderRaw), ctx.controllerSeat)
      : (_seat: PlayerSeat): boolean => true;
    const cardDefenderPred = hasDefenderFilter
      ? buildCardIdPredicate(validDefenderRaw, ctx.sourceCardId, ctx.controllerSeat)
      : (_cardId: EntityId, _game: Game): boolean => true;

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

const extractSeatToken = (raw: string | undefined): string | undefined => {
  if (raw === undefined || raw.length === 0) return undefined;
  for (const part of raw.split(",")) {
    const t = part.trim();
    if (t === "Opponent" || t === "You" || t === "Any" || t === "Player") return t;
  }
  return undefined;
};

staticHandlerRegistry.register(BlockRestrictStaticHandler);
