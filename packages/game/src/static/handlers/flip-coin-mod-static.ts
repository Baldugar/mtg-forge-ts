// SPDX-License-Identifier: GPL-3.0-or-later
// Wave 78 — FlipCoinMod static handler. CR 705 (random outcomes) +
// Forge's StaticAbilityFlipCoinMod.java equivalent.
//
// Forge cards using this shape (~1-2 cards in the corpus):
//   - Edgar, King of Figaro ("The first time you flip one or more coins
//                              each turn, those coins come up heads…")
//   - Krark's Thumb (canonical "you may flip 2 coins; ignore one"
//                     shape — registered via SVar form on a different
//                     card; this static handler is the static-form
//                     equivalent.)
//
// DSL (corpus):
//   S:Mode$ FlipCoinMod | ValidPlayer$ <filter>
//                       | CheckSVar$ <expr> | SVarCompare$ EQ0
//                       | Result$ True
//                       | Description$ ...
//
// What it does (Forge): modifies coin-flip outcomes for the matched
// player. Two canonical modes are observed:
//
//   - Result$ True   → "the next coin you flip comes up heads (or wins
//                       the call) regardless of randomness". Edgar shape.
//   - DoubleFlip$ ?  → "flip an extra coin, take the better result".
//                       Krark's Thumb / Krark's Other Thumb shape. (Forge's
//                       StaticAbilityFlipCoinMod also enumerates a
//                       Reflip$ flag for re-flip-on-loss.)
//
// At MVP scope this handler exposes the matched payload via
// `flipCoinModifier(game, seat)` so the future flip-coin pipeline can
// consult it. The runtime FlipACoinEffect (ability/effects/flip-a-coin.ts)
// reads the modifier when computing the heads/tails outcome — see
// `wave78-gate-helpers.ts` for the read-side contract.
//
// Routing: ruleChanging per MODE_TO_CATEGORY (overrides CR 705 random-
// outcome generation rather than gating an action).
//
// Scope:
//   - ValidPlayer$ <filter> — Wave 50 grammar via buildPlayerPredicate.
//                              Defaults to "Any" / always-true.
//   - Result$ True / False  — forces the outcome to that side. Default
//                              undefined (no forced outcome).
//   - DoubleFlip$ True      — flip 2 coins, pick the controller-preferred
//                              result. Default false.
//   - Reflip$ True          — Wave 101: Krark's Other Thumb shape — when a
//                              flip "is lost" by the matched player, the
//                              flip is re-flipped (the better of two
//                              outcomes wins). The runtime FlipACoinEffect
//                              consults `flipCoinModifier(game, seat)` and
//                              re-rolls when this flag is true.
// Wave 111 — closes the prior `CheckSVar$ + SVarCompare$` TODO(advanced).
// The handler now parses `CheckSVar$` (the SVar key, e.g. `X` or
// `Count$ThisTurnCounted...`) and `SVarCompare$` (the operator + count,
// e.g. `LT1` / `GE2`) into the payload's `checkSVar` slot. The runtime
// FlipACoinEffect (and any callers consulting `flipCoinModifier`) read
// `checkSVar.satisfied(game, controllerSeat)` to gate the modifier — when
// the predicate returns false the modifier is skipped (the static is
// effectively dormant). Bound at build-time with `evalPresentCompare`-
// shaped operator tokens (GE / GT / LE / LT / EQ / NE), the resolver
// reads numeric SVar slots from `game.flags.svars` (per-turn counters
// stamped by Wave 70.X SVar selectors) and falls back to 0 when the SVar
// is unbound — matching Forge's missing-SVar-defaults-to-zero contract.
import type { ParamValue, PlayerSeat, StaticAbility, StaticAst } from "@mtg-forge-ts/core";
import type { Game } from "../../game.js";
import {
  StaticHandler,
  type StaticHandlerCtx,
  normalizeActiveInZones,
  staticHandlerRegistry,
} from "../static-handler.js";
import { buildCheckSVarGate, buildPlayerPredicate, literalRaw } from "./restriction-helpers.js";

/** Forced coin-flip outcome (CR 705.4 winning a flip). */
export type FlipCoinForcedResult = "heads" | "tails";

export interface FlipCoinModPayload {
  readonly kind: "flipCoinMod";
  readonly playerMatches: (seat: PlayerSeat) => boolean;
  /**
   * If set, every coin flip by the matched player resolves to this side
   * regardless of randomness (Edgar / "those coins come up heads" shape).
   * Undefined when the static modifies flip behavior some other way
   * (e.g. doubleFlip).
   */
  readonly forcedResult: FlipCoinForcedResult | undefined;
  /**
   * Krark's-Thumb-shape modifier: flip 2 coins and let the controller
   * pick which to ignore. The runtime layer chooses the controller-
   * preferred result. False (default) when the static doesn't grant
   * the double-flip privilege.
   */
  readonly doubleFlip: boolean;
  /**
   * Wave 101 — Krark's-Other-Thumb-shape modifier: when the matched
   * player loses a coin flip, the result is re-flipped (the second
   * outcome stands). The runtime FlipACoinEffect honors this flag by
   * re-rolling once on a "lost" outcome before the result is recorded.
   * False (default) when the static doesn't grant the re-flip privilege.
   */
  readonly reflip: boolean;
  /**
   * Wave 111 — `CheckSVar$ + SVarCompare$` guard. Returns true iff the
   * gate is currently satisfied. Always-true when the static omits both
   * params (no guard). Re-evaluated per query so per-turn counters
   * (e.g. Edgar's "first time you flip a coin each turn" gating) gate
   * the modifier correctly.
   */
  readonly checkSVarSatisfied: (game: Game) => boolean;
}

const parseForcedResult = (raw: string | undefined): FlipCoinForcedResult | undefined => {
  if (raw === undefined) return undefined;
  const lower = raw.toLowerCase();
  if (lower === "true" || lower === "heads") return "heads";
  if (lower === "false" || lower === "tails") return "tails";
  return undefined;
};

const parseBool = (raw: string | undefined): boolean => raw?.toLowerCase() === "true";

export class FlipCoinModStaticHandler extends StaticHandler {
  static override readonly mode = "FlipCoinMod" as const;

  override build(ast: StaticAst, ctx: StaticHandlerCtx): StaticAbility {
    const params: Readonly<Record<string, ParamValue>> = ast.params;
    const validPlayerRaw = literalRaw(params.ValidPlayer);
    const seatPred = buildPlayerPredicate(validPlayerRaw, ctx.controllerSeat);
    const forcedResult = parseForcedResult(literalRaw(params.Result));
    const doubleFlip = parseBool(literalRaw(params.DoubleFlip));
    const reflip = parseBool(literalRaw(params.Reflip));
    // Wave 111 — CheckSVar$ + SVarCompare$ guard. Edgar's "first time you
    // flip a coin each turn" gating maps to CheckSVar$ <key> | SVarCompare$
    // LT1; the gate is satisfied while the named SVar's count is below
    // threshold and lapses once the threshold is crossed.
    const checkSVarSatisfied = buildCheckSVarGate(params, ctx.controllerSeat);

    const payload: FlipCoinModPayload = {
      kind: "flipCoinMod",
      playerMatches: (seat) => seatPred(seat),
      forcedResult,
      doubleFlip,
      reflip,
      checkSVarSatisfied,
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
      mode: "FlipCoinMod",
      describe: () => payload,
    };
  }
}

staticHandlerRegistry.register(FlipCoinModStaticHandler);
