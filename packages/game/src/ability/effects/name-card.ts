// SPDX-License-Identifier: GPL-3.0-or-later
// NameCardEffect — Forge `SP$ NameCard` / `DB$ NameCard` (Cabal Therapy,
// Pithing Needle, Aether Hub-style targeting). Yields a `nameCard` decision,
// stores the response on the source card's `namedCard` slot. Downstream
// triggers/replacements gate on card.namedCard.
//
// Forge DSL examples:
//   SVar:DBNameCard:DB$ NameCard | Defined$ You | ValidCards$ Card.nonLand
//   SVar:TrigAch:DB$ NameCard | Defined$ You | ValidCards$ Card.Creature
//
// Supported params:
//   ValidCards$ <filter> — descriptive restriction (e.g. "Card.nonLand").
//                          Passed as the request restriction string for UI.
//   Defined$ You|Opponent — picks the deciding seat (default: controller).
// Fallback when no decision response is given: a placeholder string so
// downstream effects can deterministically detect "a card was named".
import { mkPlayerSeat } from "@mtg-forge-ts/core";
import type { DecisionResponse, PlayerSeat } from "@mtg-forge-ts/core";
import type { EngineYield } from "../../action/engine-yield.js";
import type { Game } from "../../game.js";
import { effectRegistry } from "../effect-registry.js";
import { evaluateParamRaw, hasParam } from "../evaluate-param.js";
import { SpellAbilityEffect } from "../spell-ability-effect.js";
import type { SpellAbility } from "../spell-ability.js";

const FALLBACK_NAME = "Forest";

const resolveDeciderSeat = (raw: string, sa: SpellAbility): PlayerSeat => {
  const trimmed = raw.trim();
  if (trimmed === "Player.Opponent" || trimmed === "Opponent") {
    const n = sa.controllerSeat as unknown as number;
    return mkPlayerSeat(n === 0 ? 1 : 0);
  }
  return sa.controllerSeat;
};

export class NameCardEffect extends SpellAbilityEffect {
  static override readonly handlerKey = "NameCard";

  override *resolve(sa: SpellAbility, game: Game): Generator<EngineYield, void, unknown> {
    const restriction = hasParam(sa, "ValidCards") ? evaluateParamRaw(sa, "ValidCards") : "Card";
    const deciderSeat = hasParam(sa, "Defined")
      ? resolveDeciderSeat(evaluateParamRaw(sa, "Defined"), sa)
      : sa.controllerSeat;

    const rawResponse = yield {
      kind: "decision",
      request: {
        kind: "nameCard",
        sourceId: sa.sourceCardId,
        playerSeat: deciderSeat,
        restriction,
      },
    };

    const response = rawResponse as DecisionResponse | undefined;
    const chosen = response && response.kind === "nameCard" ? response.cardName : FALLBACK_NAME;

    const source = game.cards.get(sa.sourceCardId);
    if (source) {
      source.namedCard = chosen;
    }
  }
}

effectRegistry.register(NameCardEffect);
