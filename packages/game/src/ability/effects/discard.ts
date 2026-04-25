import { ZoneType } from "@mtg-forge-ts/core";
// SPDX-License-Identifier: GPL-3.0-or-later
// DiscardEffect — discards N cards from the controller's hand.
// MVP: controller discards random cards. "Target player chooses N" requires
// decision support and is deferred. Each discarded card moves to graveyard via
// action.moveTo so replacement chains (e.g. "if you would discard, exile instead")
// observe each individual discard.
import type { EngineYield } from "../../action/engine-yield.js";
import type { Game } from "../../game.js";
import { effectRegistry } from "../effect-registry.js";
import { evaluateParamNumber } from "../evaluate-param.js";
import { SpellAbilityEffect } from "../spell-ability-effect.js";
import type { SpellAbility } from "../spell-ability.js";

export class DiscardEffect extends SpellAbilityEffect {
  static override readonly handlerKey = "Discard";
  override *resolve(sa: SpellAbility, game: Game): Generator<EngineYield, void, unknown> {
    const n = evaluateParamNumber(sa, "NumCards", game);
    const player = game.getPlayer(sa.controllerSeat);
    const hand = player.zones.get(ZoneType.Hand);
    if (!hand) return;
    // Snapshot the hand contents at the start of resolution so the loop
    // doesn't re-read a mutable collection mid-iteration.
    const handCards = hand.toArray();
    const toDiscard = handCards.slice(0, n);
    for (const cardId of toDiscard) {
      yield* game.action.moveTo(cardId, ZoneType.Graveyard, { toSeat: sa.controllerSeat, cause: "discard" });
    }
  }
}

effectRegistry.register(DiscardEffect);
