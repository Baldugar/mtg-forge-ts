// SPDX-License-Identifier: GPL-3.0-or-later
// Wave 70.D — CantAttackUnless static handler. CR 506 — "creatures
// can't attack <Target> unless their controller pays <Cost>". The
// MVP shipped here exposes the cost as readable metadata; the
// validateAttackDeclarations sweep sees a `cantAttack` restriction
// when the cost is unpaid (Forge's semantics: the Unless cost is
// declared/paid as attackers are declared, so the simplest model is
// to treat the cost as unpaid by default and surface it on the
// payload for the full Forge-fidelity payment path).
//
// Forge cards using this:
//   - Propaganda             ("Creatures can't attack you unless their
//                              controller pays {2} for each creature
//                              attacking you.")
//   - Ghostly Prison         (1-cost variant of Propaganda)
//   - Mystic Barrier         ("Creatures can't attack you unless their
//                              controller pays {1}…")
//   - Vampiric Link aura-shape "can't attack unless its controller pays
//                              {1} for each card in your hand"
//   - Sphere of Resistance-style "can't attack unless its controller
//     sacrifices a land"
//
// DSL examples (top corpus shapes):
//   S:Mode$ CantAttackUnless | ValidCard$ Creature | Target$ You,Planeswalker.YouCtrl | Cost$ 1
//   S:Mode$ CantAttackUnless | ValidCard$ Creature.AttachedBy | Cost$ 3
//   S:Mode$ CantAttackUnless | ValidCard$ Creature.Self | Cost$ Sac<1/Land>
//
// What it does: the matched attacker is `cantAttack` UNLESS the
// controller pays Cost$. MVP treats the cost as unpaid (semantically
// blocks the attack), with the cost text surfaced in the payload so
// future cost-payment integration can call into the cost system.
//
// Routing: cantMustMay category. The describe() payload returns a
// concrete Restriction with `kind: cantAttack` (NOT `cantAttackUnless`
// — the validator already understands cantAttack and we promise
// "unpaid → can't attack"). The combat-handler sweep needs no change;
// the optional auxFilter carries the Target$ filter so Propaganda's
// "attacking you" carve-out still reads.
//
// MVP scope:
//   - ValidCard$ <filter>          → cardMatchesFilter (Wave 32 grammar).
//   - Target$ <player/pw filter>   → Wave 105: applied at the
//                                    `canAttackUnlessPaid` helper. Default
//                                    is "all defenders" (the cantAttack
//                                    restriction surfaces uniformly).
//                                    Propaganda's "attacking you" carve-
//                                    out maps Target$ You → only the
//                                    controller-of-static defender side
//                                    triggers the cost.
//   - Cost$ <Forge cost string>    → captured as metadata (TODO: cost-pay).
// Wave 112 closure of the prior advanced tail:
//   - The `canAttackUnlessPaid` gate now consults a per-game payment
//     ledger (`game.flags.unlessPaymentsByStaticId`) keyed by static id.
//     The cost-payment dialog at attack-declaration time stamps the
//     ledger entry by static id × attacker id × turn; on a hit the gate
//     short-circuits and returns true. Until the cost-payment dialog
//     wires through, the ledger is empty and the prior MVP semantics
//     ("unpaid → can't attack") hold for any matched attacker.
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

/** Read-side metadata: the cost text and target filter. */
export interface CantAttackUnlessPayload {
  readonly kind: "cantAttackUnlessExtended";
  readonly cardMatches: (cardId: EntityId, game: Game) => boolean;
  /** Forge cost string (e.g. "1", "X", "Sac<1/Land>"). undefined when omitted. */
  readonly costText: string | undefined;
  /** Forge Target$ filter (e.g. "You,Planeswalker.YouCtrl"). undefined when omitted. */
  readonly targetFilterRaw: string | undefined;
}

export class CantAttackUnlessStaticHandler extends StaticHandler {
  static override readonly mode = "CantAttackUnless" as const;

  override build(ast: StaticAst, ctx: StaticHandlerCtx): StaticAbility {
    const params: Readonly<Record<string, ParamValue>> = ast.params;
    const validRaw = literalRaw(params.ValidCard) ?? "Creature";
    const cardPred = buildCardIdPredicate(validRaw, ctx.sourceCardId, ctx.controllerSeat);
    const costText = literalRaw(params.Cost);
    const targetFilterRaw = literalRaw(params.Target);

    const payload: CantAttackUnlessPayload = {
      kind: "cantAttackUnlessExtended",
      cardMatches: (cardId, game) => cardPred(cardId, game),
      costText,
      targetFilterRaw,
    };

    // Translate to a concrete Restriction with kind=cantAttack so the
    // existing combat-handler sweep (validateAttackDeclarations) picks
    // it up without further plumbing. The cost is unpaid in MVP, so we
    // surface this as a flat "can't attack" matching the Valid filter.
    // The full payload is exposed via the .payload slot for the
    // canAttackUnlessPaid helper to read.
    const restriction: Restriction = {
      sourceStaticId: ctx.staticId,
      kind: "cantAttack",
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
      mode: "CantAttackUnless",
      describe: () => restriction,
    };
  }
}

staticHandlerRegistry.register(CantAttackUnlessStaticHandler);
