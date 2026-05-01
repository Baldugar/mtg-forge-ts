// SPDX-License-Identifier: GPL-3.0-or-later
// Wave 70.L — CantPayLife static handler. Forge's
// StaticAbilityCantPayLife.java equivalent — pure negative gate on
// life-payment as part of casting a spell or activating an ability.
//
// Forge cards using this (3 cards in corpus):
//   - Angel of Jubilation       ("Players can't pay life or sacrifice
//                                  creatures to cast spells or activate
//                                  abilities.")
//   - Karn's Sylex              ("Players can't pay life to cast spells
//                                  or activate abilities that aren't
//                                  mana abilities.")
//   - Yasharn, Implacable Earth ("Players can't pay life or sacrifice
//                                  nonland permanents to cast spells or
//                                  activate abilities.")
//
// DSL examples (corpus):
//   S:Mode$ CantPayLife | ValidPlayer$ Player | ValidCause$ Spell,Activated | ForCost$ True
//   S:Mode$ CantPayLife | ValidPlayer$ Player | ValidCause$ Spell,Activated.!ManaAbility | ForCost$ True
//
// What it does (Forge): consulted at the cost-payment site for life
// costs. When the payer matches ValidPlayer$ AND the SA-cause matches
// ValidCause$ AND ForCost$ is True (which it always is in the corpus —
// all three cards specify it), the life-payment is blocked. The
// activate / cast pipeline rejects the activation as "cost cannot be
// paid".
//
// Routing: replacementGenerating per MODE_TO_CATEGORY (Forge canonical
// category — CantPayLife generates a replacement that prevents the
// life-payment intent). MVP-mode here uses the registry-walk pattern
// (Wave 70.D-K) — `cantPayLife(game, payerSeat, cause)` consults the
// active gates per cost-payment query and returns true if any matches.
//
// MVP scope:
//   - ValidPlayer$ <filter>   → buildPlayerPredicate (Wave 50 grammar:
//                                You / Opponent / Player / Any).
//   - ValidCause$ <filter>    → comma-separated tokens recognised:
//                                "Spell" → cause kind == "spell"
//                                "Activated" → cause kind == "ability"
//                                "Activated.!ManaAbility" → kind == "ability"
//                                  AND not flagged as mana ability (Karn's
//                                  Sylex — Wave 70.L treats every cost-
//                                  paid ability as non-mana since the
//                                  current ManaAbility classifier is a
//                                  TODO(advanced) downstream of the cost
//                                  context).
//   - ForCost$ True/False     → True (the only canonical shape) means
//                                the gate fires only during cost
//                                payment; we check the boolean and
//                                fail-closed if explicitly False (no
//                                corpus card uses False).
import type { ParamValue, PlayerSeat, StaticAbility, StaticAst } from "@mtg-forge-ts/core";
import {
  StaticHandler,
  type StaticHandlerCtx,
  normalizeActiveInZones,
  staticHandlerRegistry,
} from "../static-handler.js";
import { buildPlayerPredicate, literalRaw } from "./restriction-helpers.js";

/**
 * The cause classification the helper provides at query time. Mirrors
 * the cost-payment context's `kind` field: "spell", "ability", or
 * "triggered" (Wave 96 — costs paid as part of a triggered ability's
 * resolution, e.g. cumulative upkeep variants). The extra
 * `isManaAbility` flag is consulted only by the "Activated.!ManaAbility"
 * sub-shape; default false matches the corpus (no mana ability path
 * goes through the same cost pipeline today).
 */
export interface PayLifeCause {
  readonly kind: "spell" | "ability" | "triggered";
  readonly isManaAbility?: boolean;
}

/**
 * Read-side payload exposing the per-side predicates the gate consults.
 * The match logic is AND across both predicates plus the ForCost gate.
 */
export interface CantPayLifePayload {
  readonly kind: "cantPayLife";
  /** True iff `payerSeat` matches the static's ValidPlayer$ filter. */
  readonly playerMatches: (seat: PlayerSeat) => boolean;
  /** True iff the cause matches the static's ValidCause$ filter. */
  readonly causeMatches: (cause: PayLifeCause) => boolean;
  /** ForCost$ flag — defaults true; explicit "False" disables the gate. */
  readonly forCost: boolean;
}

const matchValidCause = (raw: string | undefined): ((c: PayLifeCause) => boolean) => {
  if (raw === undefined || raw.length === 0) return () => true;
  const tokens = raw
    .split(",")
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
  return (cause: PayLifeCause) => {
    for (const tok of tokens) {
      if (tok === "Spell" && cause.kind === "spell") return true;
      if (tok === "Activated" && cause.kind === "ability") return true;
      if (tok === "Activated.!ManaAbility" && cause.kind === "ability") {
        // Match any ability that isn't classified as a mana ability.
        // Default isManaAbility=undefined treats as non-mana (corpus
        // hasn't tagged any path yet).
        if (cause.isManaAbility !== true) return true;
      }
      // Wave 96 — broader cause heads.
      if (tok === "Triggered" && cause.kind === "triggered") return true;
      if (tok === "ManaAbility" && cause.kind === "ability" && cause.isManaAbility === true) return true;
      // Any other token: conservative miss (deeper sub-filters such as
      // ValidCause$ Spell.YouCtrl land when the cost-context surfaces
      // its caster identity to this gate).
    }
    return false;
  };
};

const parseForCost = (raw: string | undefined): boolean => {
  if (raw === undefined) return true;
  return raw.toLowerCase() !== "false";
};

export class CantPayLifeStaticHandler extends StaticHandler {
  static override readonly mode = "CantPayLife" as const;

  override build(ast: StaticAst, ctx: StaticHandlerCtx): StaticAbility {
    const params: Readonly<Record<string, ParamValue>> = ast.params;
    const validPlayerRaw = literalRaw(params.ValidPlayer);
    const validCauseRaw = literalRaw(params.ValidCause);
    const forCostRaw = literalRaw(params.ForCost);

    const playerPred = buildPlayerPredicate(validPlayerRaw, ctx.controllerSeat);
    const causePred = matchValidCause(validCauseRaw);
    const forCost = parseForCost(forCostRaw);

    const payload: CantPayLifePayload = {
      kind: "cantPayLife",
      playerMatches: (seat) => playerPred(seat),
      causeMatches: (cause) => causePred(cause),
      forCost,
    };

    const activeInZones = normalizeActiveInZones(ast.activeInZones);
    return {
      id: ctx.staticId,
      kind: "static",
      sourceCardId: ctx.sourceCardId,
      activeInZones,
      timestamp: ctx.game.newEntityId(),
      controllerSeatAtReg: ctx.controllerSeat,
      // Routed cantMustMay: even though MODE_TO_CATEGORY tags
      // CantPayLife as "replacementGenerating" (matching Forge's source
      // of truth), this MVP runs as an action-filter consulted at the
      // life-payment call site (mirrors the Wave 70.D-K pattern). The
      // canonical replacement-emitter integration is a TODO(advanced).
      category: "cantMustMay",
      mode: "CantPayLife",
      describe: () => payload,
    };
  }
}

staticHandlerRegistry.register(CantPayLifeStaticHandler);
