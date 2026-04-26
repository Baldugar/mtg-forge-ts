// SPDX-License-Identifier: GPL-3.0-or-later
// NinjutsuEffect — resolves the synthesized Ninjutsu activated ability
// (CR 702.49). The handler is synthesized by NinjutsuKeywordHandler from
// `K:Ninjutsu:<cost>` and exists on the source card while it is in the
// caster's hand.
//
// Resolution sequence:
//   1. Enumerate the controller's UNBLOCKED attackers via a chooseCard
//      decision. The eligible pool is everything in
//      Game.cards where:
//        - controllerSeat matches,
//        - zone === Battlefield,
//        - the card is currently attacking (`attackingDefender` set), and
//        - is not blocked by any creature.
//      MVP: combat state isn't directly reachable from the Game (the
//      CombatHandler is owned by PhaseHandler), so we approximate "is
//      attacking" via `card.attackingDefender !== undefined` and
//      "unblocked" via `card.blockedBy === undefined`. If neither slot
//      is populated yet by the engine layer, the smoke test seeds them.
//   2. Return the chosen attacker to its owner's hand.
//   3. Move the source from hand to battlefield, stamp tapped + the
//      same defender as the attacker it replaced.
import type { DecisionResponse, EntityId } from "@mtg-forge-ts/core";
import { ZoneType, mkEvent } from "@mtg-forge-ts/core";
import type { EngineYield } from "../../action/engine-yield.js";
import type { Game } from "../../game.js";
import { effectRegistry } from "../effect-registry.js";
import { SpellAbilityEffect } from "../spell-ability-effect.js";
import type { SpellAbility } from "../spell-ability.js";

export class NinjutsuEffect extends SpellAbilityEffect {
  static override readonly handlerKey = "Ninjutsu";

  override *resolve(sa: SpellAbility, game: Game): Generator<EngineYield, void, unknown> {
    const sourceId = sa.sourceCardId;
    const card = game.cards.get(sourceId);
    if (!card) return;

    // Enumerate eligible: controller's attacking creatures that are not
    // blocked. We defensively widen to "attacking somewhere" using a
    // structural duck-type since the formal slot is owned by the combat
    // module — `attackingDefender` is the conventional name.
    const eligible: EntityId[] = [];
    for (const [id, c] of game.cards) {
      if (c.controllerSeat !== sa.controllerSeat) continue;
      if (c.zone !== ZoneType.Battlefield) continue;
      const cu = c as unknown as {
        attackingDefender?: EntityId | number | null;
        blockedBy?: readonly EntityId[];
      };
      if (cu.attackingDefender === undefined || cu.attackingDefender === null) continue;
      if (cu.blockedBy !== undefined && cu.blockedBy.length > 0) continue;
      eligible.push(id);
    }
    if (eligible.length === 0) return;

    const rawResponse = yield {
      kind: "decision",
      request: {
        kind: "chooseCard",
        playerSeat: sa.controllerSeat,
        pool: eligible,
        restriction: { keyword: "ninjutsu" },
        min: 1,
        max: 1,
      },
    };
    const response = rawResponse as DecisionResponse | undefined;
    if (!response || response.kind !== "chooseCard") return;
    const chosenId = response.chosen[0];
    if (chosenId === undefined || !eligible.includes(chosenId)) return;

    const chosen = game.cards.get(chosenId);
    if (!chosen) return;
    const cu = chosen as unknown as { attackingDefender?: EntityId | number | null };
    const defender = cu.attackingDefender;

    // Return the chosen attacker to its owner's hand.
    yield* game.action.moveTo(chosenId, ZoneType.Hand, { toSeat: chosen.ownerSeat });

    // Move source from hand to controller's battlefield.
    yield* game.action.moveTo(sourceId, ZoneType.Battlefield, { toSeat: sa.controllerSeat });

    // Stamp tapped + attacking the same defender as the returned creature.
    card.tapped = true;
    if (defender !== undefined && defender !== null) {
      (card as unknown as { attackingDefender?: typeof defender }).attackingDefender = defender;
    }

    yield game.emitEvent(
      mkEvent("CardTapped", game.turn, game.phase, {
        cardId: sourceId,
        sourceId,
      }),
    );
  }
}

effectRegistry.register(NinjutsuEffect);
