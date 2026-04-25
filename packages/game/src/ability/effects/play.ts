// SPDX-License-Identifier: GPL-3.0-or-later
// PlayEffect — cast a target card from any zone (graveyard, hand, exile, etc.),
// optionally without paying its mana cost.
//
// Forge DSL:
//   SP$ Play | Defined$ Targeted | Optional$ True | WithoutManaCost$ True
//   SP$ Play | Defined$ Remembered | WithoutManaCost$ True
//
// MVP supports:
//   - Defined$ Targeted: uses sa.targets[0] as the card to cast.
//   - WithoutManaCost$ True: bypasses mana cost via FreeCastPipeline subclass.
//   - Optional$ True: no-ops gracefully when no target is in sa.targets.
//
// Defined$ Remembered is deferred (needs remembered EntityId → Card lookup
// with a zone the pipeline accepts). Cards with `Optional$ True` and no
// targets are silently skipped.
//
// FreeCastPipeline overrides stepDetermineTotalCost to set base: null, which
// causes stepPayCosts to auto-pass (existing free-cast gate in cast pipeline).
import type { EntityId } from "@mtg-forge-ts/core";
import type { EngineYield } from "../../action/engine-yield.js";
import type { CastContext } from "../../cast/cast-context.js";
import { CastPipeline } from "../../cast/cast-pipeline.js";
import type { Game } from "../../game.js";
import { effectRegistry } from "../effect-registry.js";
import { evaluateParamRaw, hasParam } from "../evaluate-param.js";
import { SpellAbilityEffect } from "../spell-ability-effect.js";
import type { SpellAbility } from "../spell-ability.js";

/**
 * CastPipeline subclass that forces the total cost to null (free cast).
 * Used by PlayEffect when WithoutManaCost$ True is set.
 * The existing stepPayCosts gate (`if (totalCost.base == null) return`) means
 * no mana is deducted.
 */
class FreeCastPipeline extends CastPipeline {
  protected override *stepDetermineTotalCost(ctx: CastContext): Generator<EngineYield, void, unknown> {
    const costMods = this.game.staticEffectRegistry.byCategory("costModification");
    ctx.totalCost = {
      base: null,
      modIds: costMods.map((s) => s.id),
      additionalCostIds: [...ctx.additionalCostsPaid],
      altCostUsed: ctx.altCostUsed,
      xValue: ctx.xValue,
    };
  }
}

export class PlayEffect extends SpellAbilityEffect {
  static override readonly handlerKey = "Play";

  override *resolve(sa: SpellAbility, game: Game): Generator<EngineYield, void, unknown> {
    // Resolve Defined$ — only Targeted is supported for MVP.
    const definedRaw = hasParam(sa, "Defined") ? evaluateParamRaw(sa, "Defined") : "Targeted";
    const isOptional = hasParam(sa, "Optional") && evaluateParamRaw(sa, "Optional") === "True";
    const withoutManaCost =
      !hasParam(sa, "WithoutManaCost") || evaluateParamRaw(sa, "WithoutManaCost") === "True";

    if (definedRaw !== "Targeted") {
      // Defined$ Remembered / other forms deferred to AltCostRegistry wave.
      // Not a crash — log a note and no-op so the game continues.
      // TODO(AltCostRegistry wave): resolve Remembered → remembered[0] card.
      return;
    }

    // sa.targets[0] is the card EntityId to cast.
    const targetId: EntityId | undefined = sa.targets[0] as EntityId | undefined;
    if (!targetId) {
      // No target provided — Optional$ True means this is legal (just skip).
      if (!isOptional) {
        // Non-optional PlayEffect with no target is a programming error, but
        // we're defensive rather than crashing mid-game.
      }
      return;
    }

    const targetCard = game.cards.get(targetId);
    if (!targetCard) return;

    const pipeline = withoutManaCost ? new FreeCastPipeline(game) : game.castPipeline;

    const proposal = {
      castingPlayer: sa.controllerSeat,
      sourceCardId: targetId,
      originZone: targetCard.zone,
      asSpecialAction: false,
    };

    yield* pipeline.run(proposal) as Generator<EngineYield, unknown, unknown>;
  }
}

effectRegistry.register(PlayEffect);
