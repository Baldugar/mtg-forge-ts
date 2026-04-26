// SPDX-License-Identifier: GPL-3.0-or-later
// DiscardEffect — discards N cards from the controller's (or target's) hand.
//
// Wave 53 broadens the MVP. Forge supports several Mode$ flavours:
//   - Mode$ Hand            (default)  — controller picks N (MVP: front of hand).
//   - Mode$ Random          — controller picks N uniformly at random
//                             (using game.rng for determinism).
//   - Mode$ TgtChoose       — discard a card the targeted player chooses
//                             (MVP: front of their hand).
//   - Mode$ RevealYouChoose — target reveals N, then attacker (sa.controller)
//                             picks one to discard (MVP: pick the first
//                             revealed card; revealed event is emitted).
//
// NumCards$ accepts SVar so X-cost discard ("each opponent discards X") works.
// Defined$ resolves the discarder when sa.targets is empty.
import type { EntityId, PlayerSeat } from "@mtg-forge-ts/core";
import { ZoneType, mkEvent, mkPlayerSeat } from "@mtg-forge-ts/core";
import type { EngineYield } from "../../action/engine-yield.js";
import type { Game } from "../../game.js";
import { effectRegistry } from "../effect-registry.js";
import { evaluateParamNumber, evaluateParamRaw, hasParam } from "../evaluate-param.js";
import { SpellAbilityEffect } from "../spell-ability-effect.js";
import type { SpellAbility } from "../spell-ability.js";

const resolveDiscarderSeat = (sa: SpellAbility): PlayerSeat => {
  if (sa.targets.length > 0) return sa.targets[0] as unknown as PlayerSeat;
  if (!sa.ast.effect.params.Defined) return sa.controllerSeat;
  const tok = (sa.ast.effect.params.Defined as { kind: "literal"; raw: string }).raw.trim();
  if (tok === "Player.Opponent" || tok === "Opponent") {
    const n = sa.controllerSeat as unknown as number;
    return mkPlayerSeat(n === 0 ? 1 : 0);
  }
  return sa.controllerSeat;
};

export class DiscardEffect extends SpellAbilityEffect {
  static override readonly handlerKey = "Discard";
  override *resolve(sa: SpellAbility, game: Game): Generator<EngineYield, void, unknown> {
    const n = hasParam(sa, "NumCards") ? evaluateParamNumber(sa, "NumCards", game) : 1;
    const seat = resolveDiscarderSeat(sa);
    const player = game.getPlayer(seat);
    const hand = player.zones.get(ZoneType.Hand);
    if (!hand) return;
    const handCards = hand.toArray();
    if (handCards.length === 0) return;

    const mode = hasParam(sa, "Mode") ? evaluateParamRaw(sa, "Mode").trim() : "Hand";

    let toDiscard: readonly EntityId[];
    switch (mode) {
      case "Random": {
        // Pick N distinct cards uniformly at random, using the deterministic
        // game RNG so transcripts replay identically.
        const pool = [...handCards];
        const picked: EntityId[] = [];
        const limit = Math.min(n, pool.length);
        for (let i = 0; i < limit; i++) {
          const idx = game.rng.nextInt(0, pool.length);
          const id = pool.splice(idx, 1)[0];
          if (id !== undefined) picked.push(id);
        }
        toDiscard = picked;
        break;
      }
      case "RevealYouChoose": {
        // MVP: emit a CardsRevealed for the (up to N) reveals, then take
        // the first revealed card. Decision-driven selection of which N to
        // reveal and which to discard is wired in Wave 56+.
        const revealed = handCards.slice(0, Math.min(n, handCards.length));
        if (revealed.length > 0) {
          yield game.emitEvent(
            mkEvent("CardsRevealed", game.turn, game.phase, {
              revealedBy: seat,
              revealedTo: "all",
              cardIds: revealed,
              fromZone: ZoneType.Hand,
            }),
          );
        }
        // Attacker chooses; MVP picks the first.
        toDiscard = revealed.slice(0, 1);
        break;
      }
      // case "Hand", "TgtChoose", or any other → controller (or targeted
      //   player for TgtChoose) picks. MVP picks the front of the hand;
      //   the decision subsystem will refine in a later wave.
      default:
        toDiscard = handCards.slice(0, Math.min(n, handCards.length));
        break;
    }

    for (const cardId of toDiscard) {
      yield* game.action.moveTo(cardId, ZoneType.Graveyard, { toSeat: seat, cause: "discard" });
    }
  }
}

effectRegistry.register(DiscardEffect);
