// SPDX-License-Identifier: GPL-3.0-or-later
// Wave 74 — CantDiscard static handler. CR 701.8 — discard prevention.
//
// Forge cards using this shape:
//   - Tamiyo, Collector of Tales (Spells and abilities your opponents
//                                  control can't cause you to discard
//                                  cards or sacrifice permanents.)
//
// DSL (corpus):
//   S:Mode$ CantDiscard | ValidPlayer$ You | ValidCause$ SpellAbility.OppCtrl | ForCost$ False | Description$ ...
//
// What it does (Forge): consulted at the discard call site
// (GameAction.moveTo with cause "discard" or cost-discard.payCost).
// When ValidPlayer$ matches the player whose hand the card came from,
// the discard is rejected silently — no zone change, no CardDiscarded
// event, no DiscardedTrigger fire.
//
// Routing: replacementGenerating per MODE_TO_CATEGORY. Matches the
// rest of the Cant* family in MODE_TO_CATEGORY. The replacements list
// is empty; the gate is enforced at the discard call site.
//
// MVP scope:
//   - ValidPlayer$ <filter> via buildPlayerPredicate (You / Opponent /
//     Any / Player).
//   - "no discard period for matched player" is the durable contract.
//
// Wave 97 closures:
//   - ValidCause$ SpellAbility.OppCtrl  — block only discards caused by
//                                          opponent-controlled spells /
//                                          abilities. The discard call
//                                          site threads an optional
//                                          `causeControllerSeat` so the
//                                          gate compares against the
//                                          static's controller. SVar
//                                          tail covers SpellAbility.YouCtrl
//                                          / SpellAbility (any controller)
//                                          for completeness.
//   - ForCost$ True/False               — when False (Tamiyo et al.) the
//                                          gate blocks ONLY effect-driven
//                                          discard, leaving cost-driven
//                                          discard (Madness payment, etc.)
//                                          alone. When True the gate
//                                          blocks ONLY cost-driven discard.
//                                          When undefined the gate blocks
//                                          both — the canonical default.
import type {
  ParamValue,
  PlayerSeat,
  ReplacementAbility,
  StaticAbility,
  StaticAst,
} from "@mtg-forge-ts/core";
import type { ReplacementGenPayload } from "../../statics/replacement-generating.js";
import {
  StaticHandler,
  type StaticHandlerCtx,
  normalizeActiveInZones,
  staticHandlerRegistry,
} from "../static-handler.js";
import { buildPlayerPredicate, literalRaw } from "./restriction-helpers.js";

/**
 * The discard-cause classification a caller threads through to the
 * gate. `kind === "cost"` for cost-payment discards (Madness payment
 * lane); `kind === "effect"` for effect-driven discards (random discard,
 * targeted discard, etc.). `causeControllerSeat` is the seat
 * controlling the spell / ability that initiated the discard; when
 * absent, the gate's ValidCause$ controller-scoped tokens are
 * conservatively treated as non-matching.
 */
export interface DiscardCause {
  readonly kind: "cost" | "effect";
  readonly causeControllerSeat?: PlayerSeat;
}

export interface CantDiscardPayload extends ReplacementGenPayload {
  readonly playerMatches: (seat: PlayerSeat) => boolean;
  /**
   * Wave 97 — true iff the discard's cause classification matches the
   * static's ValidCause$ + ForCost$ filters. Undefined parameters are
   * the canonical "any cause" / "any cost-mode" shape.
   */
  readonly causeMatches: (cause: DiscardCause, staticControllerSeat: PlayerSeat) => boolean;
}

export class CantDiscardStaticHandler extends StaticHandler {
  static override readonly mode = "CantDiscard" as const;

  override build(ast: StaticAst, ctx: StaticHandlerCtx): StaticAbility {
    const params: Readonly<Record<string, ParamValue>> = ast.params;
    const validPlayerRaw = literalRaw(params.ValidPlayer);
    const seatPred = buildPlayerPredicate(validPlayerRaw, ctx.controllerSeat);

    // Wave 97 — ValidCause$ + ForCost$ sub-filters.
    const validCauseRaw = literalRaw(params.ValidCause);
    const forCostRaw = literalRaw(params.ForCost);
    let forCostMode: "costOnly" | "effectOnly" | "both" = "both";
    if (forCostRaw !== undefined) {
      forCostMode = forCostRaw.toLowerCase() === "false" ? "effectOnly" : "costOnly";
    }
    const causeTokens =
      validCauseRaw === undefined
        ? undefined
        : validCauseRaw
            .split(",")
            .map((s) => s.trim())
            .filter((s) => s.length > 0);

    const causeMatches = (cause: DiscardCause, staticCtrl: PlayerSeat): boolean => {
      // ForCost$ gate.
      if (forCostMode === "costOnly" && cause.kind !== "cost") return false;
      if (forCostMode === "effectOnly" && cause.kind !== "effect") return false;
      // ValidCause$ gate.
      if (causeTokens === undefined || causeTokens.length === 0) return true;
      for (const tok of causeTokens) {
        // Bare "SpellAbility" matches any controller.
        if (tok === "SpellAbility") return true;
        if (
          tok === "SpellAbility.OppCtrl" &&
          cause.causeControllerSeat !== undefined &&
          cause.causeControllerSeat !== staticCtrl
        ) {
          return true;
        }
        if (tok === "SpellAbility.YouCtrl" && cause.causeControllerSeat === staticCtrl) {
          return true;
        }
      }
      return false;
    };

    const payload: CantDiscardPayload = {
      kind: "replacementGen",
      replacements: [] as readonly ReplacementAbility[],
      playerMatches: (seat) => seatPred(seat),
      causeMatches,
    };

    const activeInZones = normalizeActiveInZones(ast.activeInZones);
    return {
      id: ctx.staticId,
      kind: "static",
      sourceCardId: ctx.sourceCardId,
      activeInZones,
      timestamp: ctx.game.newEntityId(),
      controllerSeatAtReg: ctx.controllerSeat,
      category: "replacementGenerating",
      mode: "CantDiscard",
      describe: () => payload,
    };
  }
}

staticHandlerRegistry.register(CantDiscardStaticHandler);
