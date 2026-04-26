// SPDX-License-Identifier: GPL-3.0-or-later
// SaddleEffect — resolves the synthesized Saddle activated ability
// (CR 702.165). Synthesized by SaddleKeywordHandler on a Mount with
// K:Saddle:N; runs once the activated ability resolves off the stack.
//
// Saddle parallels Crew with two differences:
//   - Mounts are already creatures (Types: Artifact Creature Mount), so we
//     do NOT add CardType.Creature in deriveBaseCharacteristics — the flag
//     `card.saddledUntilEot` is consulted by triggers (BecomesSaddled /
//     Saddled) and SVar conditions referencing the saddled state, but the
//     type set is unchanged.
//   - We emit a Saddled event (not Crewed).
//
// All other steps mirror CrewEffect — see crew.ts for the full play-by-play.
import type { ContinuousEffect, DecisionResponse, EntityId } from "@mtg-forge-ts/core";
import { CardType, Layer, mkEvent } from "@mtg-forge-ts/core";
import type { EngineYield } from "../../action/engine-yield.js";
import type { Game } from "../../game.js";
import { effectRegistry } from "../effect-registry.js";
import { evaluateParamNumber } from "../evaluate-param.js";
import { SpellAbilityEffect } from "../spell-ability-effect.js";
import type { SpellAbility } from "../spell-ability.js";

const sumPower = (game: Game, ids: readonly EntityId[]): number => {
  let total = 0;
  for (const id of ids) {
    const chars = game.layerEngine.computeCharacteristics(id);
    const p = chars.power;
    if (p !== null && Number.isFinite(p)) total += p;
  }
  return total;
};

export class SaddleEffect extends SpellAbilityEffect {
  static override readonly handlerKey = "Saddle";

  override *resolve(sa: SpellAbility, game: Game): Generator<EngineYield, void, unknown> {
    const sourceId: EntityId = sa.sourceCardId;
    const card = game.cards.get(sourceId);
    if (!card) return;

    const requiredPower = evaluateParamNumber(sa, "SaddlePower", game);

    // Enumerate eligible untapped creatures the controller controls,
    // excluding the Mount itself (CR 702.165 — "creatures you control other
    // than this one").
    const eligible: EntityId[] = [];
    for (const [id, c] of game.cards) {
      if (id === sourceId) continue;
      if (c.controllerSeat !== sa.controllerSeat) continue;
      if (c.tapped) continue;
      const chars = game.layerEngine.computeCharacteristics(id);
      if (!chars.types.has(CardType.Creature)) continue;
      eligible.push(id);
    }

    const rawResponse = yield {
      kind: "decision",
      request: {
        kind: "chooseCrewSaddleCreatures",
        mode: "saddle",
        playerSeat: sa.controllerSeat,
        sourceCardId: sourceId,
        requiredPower,
        eligible,
      },
    };
    const response = rawResponse as DecisionResponse | undefined;
    if (!response || response.kind !== "chooseCrewSaddleCreatures") return;

    const tapIds = response.tapIds;
    if (tapIds.length === 0) return; // declined / fizzled

    const eligibleSet = new Set(eligible);
    const seen = new Set<EntityId>();
    for (const tid of tapIds) {
      if (!eligibleSet.has(tid)) return;
      if (seen.has(tid)) return;
      seen.add(tid);
    }
    if (sumPower(game, tapIds) < requiredPower) return;

    for (const tid of tapIds) {
      const c = game.cards.get(tid);
      if (!c) continue;
      c.tapped = true;
      yield game.emitEvent(
        mkEvent("CardTapped", game.turn, game.phase, {
          cardId: tid,
          sourceId,
        }),
      );
    }

    // Stamp the saddled flag and register the EOT cleanup hook. Mounts stay
    // creatures throughout — this is purely a transient marker for triggers
    // and SVar conditions.
    card.saddledUntilEot = true;
    const effectId = game.newEntityId();
    const continuousEffect: ContinuousEffect = {
      id: effectId,
      sourceCardId: sourceId,
      timestamp: game.newEntityId(),
      layer: Layer.L6_Ability,
      duration: { kind: "untilEndOfTurn" },
      payload: { kind: "noop" },
    };
    game.continuousEffectRegistry.register(continuousEffect);
    game.continuousEffectRegistry.registerCleanup(effectId, (g) => {
      const m = g.cards.get(sourceId);
      if (m) m.saddledUntilEot = false;
    });

    yield game.emitEvent(
      mkEvent("Saddled", game.turn, game.phase, {
        mountId: sourceId,
        riderIds: [...tapIds],
      }),
    );
  }
}

effectRegistry.register(SaddleEffect);
