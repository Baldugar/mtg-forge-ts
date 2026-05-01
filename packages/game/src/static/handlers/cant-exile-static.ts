// SPDX-License-Identifier: GPL-3.0-or-later
// Wave 75 — CantExile static handler. CR 406 — exile prevention.
// Forge's StaticAbilityCantExile.java equivalent.
//
// Forge cards using this:
//   - The Master, Multiplied (DOC) — "Triggered abilities you control
//                                       can't cause you to sacrifice
//                                       or exile creature tokens you
//                                       control." (paired with the
//                                       sibling CantSacrifice mode;
//                                       this static is Secondary$ True
//                                       to share the rules text)
//
// DSL (corpus):
//   S:Mode$ CantExile | ValidCard$ Creature.YouCtrl+token
//          | ValidCause$ Triggered.YouCtrl | ForCost$ False
//          | Secondary$ True | Description$ ...
//
// What it does (Forge): consulted at GameAction.moveTo when the
// destination zone is Exile. When ValidCard$ matches the card being
// moved, the move is rejected silently — no zone change, no
// CardChangedZone event for the Exile transition. Mirrors the Wave
// 70.O CantPhaseIn / Wave 74 CantDiscard silent-rejection pattern.
//
// Routing: replacementGenerating per MODE_TO_CATEGORY. The
// replacements list is empty; the gate is enforced at the moveTo
// call site rather than via a derived replacement chain.
//
// MVP scope:
//   - ValidCard$ <filter> via buildCardIdPredicate (Card.Self,
//     Card.IsRemembered, Wave 50/32 grammar including
//     Creature.YouCtrl+token).
//   - "exile destination rejected for matched card" is the durable
//     contract.
// Wave 110 — closes the prior `ValidCause$` and `ForCost$` TODO(advanced)
// tail. The Master, Multiplied's canonical "Triggered abilities you control
// can't cause you to … exile creature tokens you control" shape now
// threads the cause's controller seat + cost-vs-effect classification
// through the gate, mirroring CantSacrifice's Sigarda-shape closure (also
// landed in Wave 110). Tokens recognised:
//
//   - ValidCause$ Triggered.YouCtrl     — Master, Multiplied (canonical).
//   - ValidCause$ Triggered.OppCtrl     — opp-driven triggered exile only.
//   - ValidCause$ Triggered             — any triggered exile.
//   - ValidCause$ SpellAbility[.X]      — spell/ability driven, with the
//                                          same OppCtrl/YouCtrl heads.
//   - ForCost$ True / False             — cost-driven vs. effect-driven.
//
// The `canBeExiled` consumer accepts an optional `ExileCause` payload
// (carrying both the cause-controller-seat and the cost-mode flag); when
// omitted, behavior matches pre-Wave-110 (no sub-filter gating).
import type {
  EntityId,
  ParamValue,
  PlayerSeat,
  ReplacementAbility,
  StaticAbility,
  StaticAst,
} from "@mtg-forge-ts/core";
import type { Game } from "../../game.js";
import type { ReplacementGenPayload } from "../../statics/replacement-generating.js";
import {
  StaticHandler,
  type StaticHandlerCtx,
  normalizeActiveInZones,
  staticHandlerRegistry,
} from "../static-handler.js";
import { buildCardIdPredicate, literalRaw } from "./restriction-helpers.js";

/**
 * Wave 110 — exile-cause classification a caller threads through to the
 * gate. `kind === "cost"` for cost-payment exiles (e.g. cumulative-upkeep
 * exile-as-cost variants); `kind === "effect"` for effect-driven exiles
 * (a resolving spell instructing "exile target …"); `kind === "triggered"`
 * for triggered-ability driven exiles. `causeControllerSeat` is the seat
 * controlling the spell / ability that initiated the exile; when absent,
 * the gate's ValidCause$ controller-scoped tokens are conservatively
 * treated as non-matching.
 */
export interface ExileCause {
  readonly kind: "cost" | "effect" | "triggered";
  readonly causeControllerSeat?: PlayerSeat;
}

export interface CantExilePayload extends ReplacementGenPayload {
  readonly cardMatches: (cardId: EntityId, game: Game) => boolean;
  /**
   * Wave 110 — true iff the exile's cause classification matches the
   * static's ValidCause$ + ForCost$ filters. When both filters are absent
   * (the canonical pre-Wave-110 shape) this returns true for any cause.
   */
  readonly causeMatches: (cause: ExileCause, staticControllerSeat: PlayerSeat) => boolean;
  /**
   * Wave 110 — the static's controller seat at registration time; surfaced
   * so the gate consumer can resolve OppCtrl/YouCtrl tokens relative to
   * the controller of the card that stamped the static.
   */
  readonly staticControllerSeat: PlayerSeat;
}

export class CantExileStaticHandler extends StaticHandler {
  static override readonly mode = "CantExile" as const;

  override build(ast: StaticAst, ctx: StaticHandlerCtx): StaticAbility {
    const params: Readonly<Record<string, ParamValue>> = ast.params;
    const validCardRaw = literalRaw(params.ValidCard) ?? "Card.Self";
    const pred = buildCardIdPredicate(validCardRaw, ctx.sourceCardId, ctx.controllerSeat);

    // Wave 110 — ValidCause$ + ForCost$ sub-filter wiring.
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

    const causeMatches = (cause: ExileCause, staticCtrl: PlayerSeat): boolean => {
      // ForCost$ gate.
      if (forCostMode === "costOnly" && cause.kind !== "cost") return false;
      if (forCostMode === "effectOnly" && cause.kind === "cost") return false;
      // ValidCause$ gate.
      if (causeTokens === undefined || causeTokens.length === 0) return true;
      for (const tok of causeTokens) {
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
        if (tok === "Triggered" && cause.kind === "triggered") return true;
        if (
          tok === "Triggered.YouCtrl" &&
          cause.kind === "triggered" &&
          cause.causeControllerSeat === staticCtrl
        ) {
          return true;
        }
        if (
          tok === "Triggered.OppCtrl" &&
          cause.kind === "triggered" &&
          cause.causeControllerSeat !== undefined &&
          cause.causeControllerSeat !== staticCtrl
        ) {
          return true;
        }
      }
      return false;
    };

    const payload: CantExilePayload = {
      kind: "replacementGen",
      replacements: [] as readonly ReplacementAbility[],
      cardMatches: (cardId, game) => pred(cardId, game),
      causeMatches,
      staticControllerSeat: ctx.controllerSeat,
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
      mode: "CantExile",
      describe: () => payload,
    };
  }
}

staticHandlerRegistry.register(CantExileStaticHandler);
