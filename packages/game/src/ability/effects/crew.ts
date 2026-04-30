// SPDX-License-Identifier: GPL-3.0-or-later
// CrewEffect — resolves the synthesized Crew activated ability (CR 702.121).
// Synthesized by CrewKeywordHandler on a Vehicle with K:Crew:N; runs once
// the activated ability resolves off the stack.
//
// Resolution sequence:
//   1. Read the power threshold from sa.ast.effect.params.CrewPower (set by
//      the keyword handler at synthesis time).
//   2. Enumerate UNTAPPED creatures the controller controls (other than the
//      Vehicle itself, which is normally not a creature anyway). The
//      eligible set is exposed via a chooseCrewSaddleCreatures decision.
//   3. Validate the responder's chosen subset:
//        - every id is in the eligible set,
//        - no duplicates,
//        - the summed effective power is at least the threshold.
//      If validation fails OR the responder picks an empty set, the ability
//      resolves with no effect (no taps, no flag flip, no event). This
//      matches Forge's "if you don't choose enough, the ability fizzles"
//      behavior.
//   4. Tap each chosen creature (direct mutation; we are inside the
//      activated-ability resolution, not a cost-payment phase).
//   5. Stamp `card.crewedUntilEot = true` and register a no-op
//      ContinuousEffect with `untilEndOfTurn` duration. The cleanup hook
//      clears the flag at expiry. deriveBaseCharacteristics reads the flag
//      to add CardType.Creature to the Vehicle's base type set.
//   6. Bump the layer engine epoch so the next computeCharacteristics call
//      sees the new types.
//   7. Emit a Crewed event so CrewedTrigger (Wave 19) fires.
//
// MVP scope:
//   - Effective power is read from the layer engine's computeCharacteristics.
//     Null/NaN power values (CR 208.2 "*" / "X") are treated as 0 for the
//     summation gate.
//   - Crew does NOT consume mana or any other resource — only the tap of
//     chosen creatures. A creature with summoning sickness is allowed to
//     crew because crewing is NOT a cost that taps the creature for mana
//     or activates an ability of the creature itself; the creature's tap is
//     paid as part of the Vehicle's ability. (Forge parity.)
import type { ContinuousEffect, DecisionResponse, EntityId } from "@mtg-forge-ts/core";
import { CardType, Layer, mkEvent } from "@mtg-forge-ts/core";
import type { EngineYield } from "../../action/engine-yield.js";
import type { Game } from "../../game.js";
import { effectiveTapPowerValue } from "../../statics/wave72-tap-power-value.js";
import { effectRegistry } from "../effect-registry.js";
import { evaluateParamNumber } from "../evaluate-param.js";
import { SpellAbilityEffect } from "../spell-ability-effect.js";
import type { SpellAbility } from "../spell-ability.js";

// Wave 72 — TapPowerValue statics (Hotshot Mechanic et al.) substitute
// the per-creature contribution to the crew total. We consult the
// effectiveTapPowerValue helper per id; when no static matches, the
// helper returns null and we fall back to the creature's effective
// power.
const sumPower = (game: Game, sourceId: EntityId, ids: readonly EntityId[]): number => {
  let total = 0;
  for (const id of ids) {
    const chars = game.layerEngine.computeCharacteristics(id);
    const tpv = effectiveTapPowerValue(game, id, {
      saKind: "Crew",
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

export class CrewEffect extends SpellAbilityEffect {
  static override readonly handlerKey = "Crew";

  override *resolve(sa: SpellAbility, game: Game): Generator<EngineYield, void, unknown> {
    const sourceId: EntityId = sa.sourceCardId;
    const card = game.cards.get(sourceId);
    if (!card) return;

    const requiredPower = evaluateParamNumber(sa, "CrewPower", game);

    // Enumerate eligible untapped creatures the controller controls
    // (excluding the Vehicle itself). Must use the layer engine for the
    // type check so layered animate effects are honored.
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
        mode: "crew",
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

    // Validate: every id eligible, no duplicates, sum ≥ requiredPower.
    const eligibleSet = new Set(eligible);
    const seen = new Set<EntityId>();
    for (const tid of tapIds) {
      if (!eligibleSet.has(tid)) return; // illegal — fizzle
      if (seen.has(tid)) return;
      seen.add(tid);
    }
    if (sumPower(game, sourceId, tapIds) < requiredPower) return; // not enough power — fizzle

    // Tap the chosen creatures. Direct mutation: this happens during effect
    // resolution, not as a cost — no CardTapped event for the cost-tap path
    // is required, but for parity with the rest of the engine (combat,
    // mana abilities tap and emit), we emit one per creature.
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

    // Stamp the transient flag and register the EOT cleanup hook. The
    // ContinuousEffect itself is a noop — it exists only to drive expiry.
    card.crewedUntilEot = true;
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
      if (v) v.crewedUntilEot = false;
      g.layerEngine.bumpEpoch("crew-cleanup");
    });

    // Bump the epoch so the next computeCharacteristics call rereads the
    // base types with the new flag.
    game.layerEngine.bumpEpoch("crew");

    // Announce the crewing.
    yield game.emitEvent(
      mkEvent("Crewed", game.turn, game.phase, {
        vehicleId: sourceId,
        crewIds: [...tapIds],
      }),
    );
  }
}

effectRegistry.register(CrewEffect);
