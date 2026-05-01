// SPDX-License-Identifier: GPL-3.0-or-later
// Wave 70.J — CantBlockUnless static handler. Mirrors the Wave 70.D
// CantAttackUnless handler on the block side. CR 506 / CR 509 — "[the
// matched creature] can't block UNLESS its controller pays Cost$".
//
// Forge cards using this:
//   - Aurochs Herd-shape "can't block unless its controller pays {1}"
//   - Crawlspace siblings           ("can't block unless …")
//   - Vampiric Link aura blocker variant
//   - Power-3+ guardrails           ("CARDNAME can't block creatures
//                                     with power 3 or greater unless
//                                     you pay {1}.")
//   - "tap creature" cost variants  ("can't block unless its controller
//                                     taps an untapped creature they control")
//   - "PayLife<N>" cost variants    ("can't block unless its controller
//                                     pays N life for each blocking creature")
//   - Self-shape (Card.Self)        ("CARDNAME can't block unless …")
//
// DSL examples (top corpus shapes):
//   S:Mode$ CantBlockUnless | ValidCard$ Card.Self | Cost$ 2
//   S:Mode$ CantBlockUnless | ValidCard$ Creature.AttachedBy | Cost$ 3
//   S:Mode$ CantBlockUnless | ValidCard$ Creature.nonBlue
//                            | Attacker$ Creature.YouCtrl
//                            | Cost$ PayLife<1>
//   S:Mode$ CantBlockUnless | ValidCard$ Card.Self
//                            | Attacker$ Creature.powerGE3
//                            | Cost$ 1
//
// What it does: the matched blocker is `cantBlock` UNLESS the
// controller pays Cost$. MVP treats the cost as unpaid (semantically
// blocks the block), with the cost text + Attacker$ filter surfaced on
// the payload for future cost-payment integration.
//
// Routing: cantMustMay category. The describe() payload returns a
// concrete Restriction with `kind: cantBlock` (NOT a new
// `cantBlockUnless` kind — the validator already understands cantBlock
// and we promise "unpaid → can't block"). The combat-handler block-
// restrictions sweep needs no change; the optional Attacker$ filter
// (when present) means the gate ONLY restricts blocking that specific
// attacker.
//
// MVP scope:
//   - ValidCard$ <filter>             → cardMatchesFilter (Wave 32 grammar).
//   - Attacker$ <attacker filter>     → currently surfaced on payload only;
//                                       the combat sweep filters on subjectId.
//   - Cost$ <Forge cost string>       → captured as metadata (TODO: cost-pay).
// Wave 112 closure of the prior advanced tail:
//   - The payload now exposes `attackerMatches(cardId, game)` so the
//     `isBlockingRestricted` validation site (cant-must-may-extras.ts)
//     applies Attacker$ at query time. When Attacker$ is specified and
//     the candidate attacker doesn't match, the gate doesn't fire — the
//     blocker may block this attacker freely (only OTHER attackers
//     remain restricted absent the cost-payment).
//   - The cost-payment dialog at block-declaration time stamps a
//     ledger entry via `recordCantBlockUnlessPayment(game, staticId,
//     blockerId)`; the gate consults `unlessPaymentsByStaticId` and
//     short-circuits on a hit. Until the dialog wires through, the
//     ledger is empty and the prior MVP semantics hold.
import type { EntityId, ParamValue, StaticAbility, StaticAst } from "@mtg-forge-ts/core";
import type { Game } from "../../game.js";
import type { Restriction } from "../../statics/cant-must-may.js";
import {
  StaticHandler,
  type StaticHandlerCtx,
  normalizeActiveInZones,
  staticHandlerRegistry,
} from "../static-handler.js";
import { buildCardIdPredicate, literalRaw } from "./restriction-helpers.js";

/** Read-side metadata: the cost text and attacker filter. */
export interface CantBlockUnlessPayload {
  readonly kind: "cantBlockUnlessExtended";
  readonly cardMatches: (cardId: EntityId, game: Game) => boolean;
  /** Forge cost string (e.g. "1", "PayLife<1>", "tapXType<1/Creature>"). undefined when omitted. */
  readonly costText: string | undefined;
  /** Forge Attacker$ filter (e.g. "Creature.powerGE3"). undefined when omitted. */
  readonly attackerFilterRaw: string | undefined;
  /**
   * Wave 112 — predicate over the candidate attacker. True when
   * Attacker$ matches the attacker (or is omitted, in which case ALL
   * attackers match — the gate restricts the blocker uniformly).
   * Consumed by `isBlockingRestricted` to honor the per-attacker carve-
   * out. NOTE: when `attackerFilterRaw === undefined`, `attackerMatches`
   * always returns true (back-compat for the MVP shape).
   */
  readonly attackerMatches: (cardId: EntityId, game: Game) => boolean;
}

export class CantBlockUnlessStaticHandler extends StaticHandler {
  static override readonly mode = "CantBlockUnless" as const;

  override build(ast: StaticAst, ctx: StaticHandlerCtx): StaticAbility {
    const params: Readonly<Record<string, ParamValue>> = ast.params;
    const validRaw = literalRaw(params.ValidCard) ?? "Creature";
    const cardPred = buildCardIdPredicate(validRaw, ctx.sourceCardId, ctx.controllerSeat);
    const costText = literalRaw(params.Cost);
    const attackerFilterRaw = literalRaw(params.Attacker);
    // Wave 112 — Attacker$ predicate so the validation site
    // (`isBlockingRestricted`) can honor the carve-out without
    // re-parsing.
    const attackerPred =
      attackerFilterRaw === undefined || attackerFilterRaw.length === 0
        ? () => true
        : buildCardIdPredicate(attackerFilterRaw, ctx.sourceCardId, ctx.controllerSeat);

    const payload: CantBlockUnlessPayload = {
      kind: "cantBlockUnlessExtended",
      cardMatches: (cardId, game) => cardPred(cardId, game),
      costText,
      attackerFilterRaw,
      attackerMatches: (cardId, game) => attackerPred(cardId, game),
    };

    // Translate to a concrete Restriction with kind=cantBlock so the
    // existing combat-handler block-restrictions sweep
    // (isBlockingRestricted) picks it up without further plumbing. The
    // cost is unpaid in MVP, so we surface this as a flat "can't block"
    // matching the Valid filter. The full payload is exposed via the
    // .payload slot for the canBlockUnlessPaid helper to read.
    const restriction: Restriction = {
      sourceStaticId: ctx.staticId,
      kind: "cantBlock",
      subjectFilter: (subjectId, game) => {
        if (typeof subjectId !== "number" && typeof subjectId !== "object") return false;
        return cardPred(subjectId as EntityId, game);
      },
      payload,
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
      mode: "CantBlockUnless",
      describe: () => restriction,
    };
  }
}

staticHandlerRegistry.register(CantBlockUnlessStaticHandler);
