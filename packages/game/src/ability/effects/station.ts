// SPDX-License-Identifier: GPL-3.0-or-later
// StationEffect — resolves the synthesized Station activated ability
// (CR 718, Aetherdrift Spacecraft). Mirrors CrewEffect exactly:
//
//   1. Read StationPower from sa.ast.effect.params.
//   2. Enumerate UNTAPPED creatures the controller controls (excluding the
//      Spacecraft itself, which is normally not a creature anyway).
//   3. Yield a chooseCrewSaddleCreatures decision with mode "station".
//   4. Validate the responder's chosen subset (eligible, no dupes, power
//      sum ≥ threshold). Empty / invalid → fizzle.
//   5. Tap each chosen creature (emit CardTapped per parity with Crew).
//   6. Stamp `card.stationedUntilEot = true` and register a no-op
//      ContinuousEffect with `untilEndOfTurn` duration. Cleanup hook
//      clears the flag at expiry; deriveBaseCharacteristics adds Creature
//      to the type set while the flag is true.
//   7. Bump the layer epoch so the next computeCharacteristics rereads.
//   8. Emit CardStationed so StationedTrigger fires.
import type { ContinuousEffect, DecisionResponse, EntityId } from "@mtg-forge-ts/core";
import { CardType, Layer, mkEvent } from "@mtg-forge-ts/core";
import type { EngineYield } from "../../action/engine-yield.js";
import type { Game } from "../../game.js";
import { effectiveTapPowerValue } from "../../statics/wave72-tap-power-value.js";
import { effectRegistry } from "../effect-registry.js";
import { evaluateParamNumber } from "../evaluate-param.js";
import { SpellAbilityEffect } from "../spell-ability-effect.js";
import type { SpellAbility } from "../spell-ability.js";

// Wave 72 — TapPowerValue statics override per-creature station
// contribution. Mirror of crew.ts's sumPower.
const sumPower = (game: Game, sourceId: EntityId, ids: readonly EntityId[]): number => {
  let total = 0;
  for (const id of ids) {
    const chars = game.layerEngine.computeCharacteristics(id);
    const tpv = effectiveTapPowerValue(game, id, {
      saKind: "Station",
      activatingSourceId: sourceId,
    });
    if (tpv?.useToughness) {
      const t = chars.toughness;
      if (t !== null && Number.isFinite(t)) total += Math.max(0, t);
      continue;
    }
    const p = chars.power;
    if (p !== null && Number.isFinite(p)) {
      total += Math.max(0, p + (tpv?.mod ?? 0));
    } else if (tpv) {
      total += Math.max(0, tpv.mod);
    }
  }
  return total;
};

export class StationEffect extends SpellAbilityEffect {
  static override readonly handlerKey = "Station";

  override *resolve(sa: SpellAbility, game: Game): Generator<EngineYield, void, unknown> {
    const sourceId: EntityId = sa.sourceCardId;
    const card = game.cards.get(sourceId);
    if (!card) return;

    const requiredPower = evaluateParamNumber(sa, "StationPower", game);

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
        mode: "station",
        playerSeat: sa.controllerSeat,
        sourceCardId: sourceId,
        requiredPower,
        eligible,
      },
    };
    const response = rawResponse as DecisionResponse | undefined;
    if (!response || response.kind !== "chooseCrewSaddleCreatures") return;

    const tapIds = response.tapIds;
    if (tapIds.length === 0) return;

    const eligibleSet = new Set(eligible);
    const seen = new Set<EntityId>();
    for (const tid of tapIds) {
      if (!eligibleSet.has(tid)) return;
      if (seen.has(tid)) return;
      seen.add(tid);
    }
    if (sumPower(game, sourceId, tapIds) < requiredPower) return;

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

    card.stationedUntilEot = true;
    const effectId = game.newEntityId();
    const continuousEffect: ContinuousEffect = {
      id: effectId,
      sourceCardId: sourceId,
      timestamp: game.newEntityId(),
      layer: Layer.L4_Type,
      duration: { kind: "untilEndOfTurn" },
      payload: { kind: "noop" },
    };
    game.continuousEffectRegistry.register(continuousEffect);
    game.continuousEffectRegistry.registerCleanup(effectId, (g) => {
      const v = g.cards.get(sourceId);
      if (v) v.stationedUntilEot = false;
      g.layerEngine.bumpEpoch("station-cleanup");
    });

    game.layerEngine.bumpEpoch("station");

    yield game.emitEvent(
      mkEvent("CardStationed", game.turn, game.phase, {
        vehicleId: sourceId,
        stationerIds: [...tapIds],
      }),
    );
  }
}

effectRegistry.register(StationEffect);
