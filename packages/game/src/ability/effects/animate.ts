// SPDX-License-Identifier: GPL-3.0-or-later
// AnimateEffect — turns a permanent into a creature with specified P/T until
// end of turn (or Duration$ param). Applies two layered continuous effects:
//   Layer 4 (type): adds CardType.Creature to the permanent's type set.
//   Layer 7b (PT set): sets base P/T to the specified values.
//
// Forge DSL:
//   A:AB$ Animate | Cost$ T | Defined$ Self | Power$ 3 | Toughness$ 3
//         | Types$ Creature | Duration$ untilEndOfTurn
//
// Layer scoping note: both effects are registered globally (they apply when
// computing ANY card's characteristics). This is the current MVP behavior
// matching the existing Layer 4 / Layer 7b infrastructure which does not yet
// carry a targetCardId filter. A Mishra's Factory-style test works correctly
// because there is only one candidate card in scope at resolution time.
// SP4 will add per-card scoping when the full board-state animate pattern
// (multiple animated permanents simultaneously) is required.
//
// MVP: Duration$ untilEndOfTurn only; "permanent" is also supported.
// Other duration forms (untilCombatEnds, etc.) are deferred to SP3+.
import { CardType, type ContinuousEffect, Layer } from "@mtg-forge-ts/core";
import type { EngineYield } from "../../action/engine-yield.js";
import type { Game } from "../../game.js";
import type { TypeChangeEffect } from "../../layers/layer4-type.js";
import type { Layer7bEffect } from "../../layers/layer7-pt.js";
import { effectRegistry } from "../effect-registry.js";
import { evaluateParamNumber, evaluateParamRaw, hasParam } from "../evaluate-param.js";
import { SpellAbilityEffect } from "../spell-ability-effect.js";
import type { SpellAbility } from "../spell-ability.js";

export class AnimateEffect extends SpellAbilityEffect {
  static override readonly handlerKey = "Animate";

  // biome-ignore lint/correctness/useYield: ContinuousEffectRegistry.register is synchronous — no EngineYield to emit
  override *resolve(sa: SpellAbility, game: Game): Generator<EngineYield, void, unknown> {
    const power = hasParam(sa, "Power") ? evaluateParamNumber(sa, "Power", game) : 0;
    const toughness = hasParam(sa, "Toughness") ? evaluateParamNumber(sa, "Toughness", game) : 0;

    // Duration — MVP supports untilEndOfTurn (default) or permanent.
    const durationRaw = hasParam(sa, "Duration") ? evaluateParamRaw(sa, "Duration") : "untilEndOfTurn";
    const duration: ContinuousEffect["duration"] =
      durationRaw.toLowerCase() === "permanent" ? { kind: "permanent" } : { kind: "untilEndOfTurn" };

    // Both effects share the same timestamp so the dependency resolver keeps
    // them together in same-layer ordering.
    const timestamp: number = game.newEntityId();

    // Layer 4 — add Creature type to the type set.
    const typeChange: TypeChangeEffect = {
      kind: "add",
      cardType: CardType.Creature,
      isCda: false,
      timestamp,
      sourceAbilityId: sa.sourceCardId,
    };
    const typeEffect: ContinuousEffect = {
      id: game.newEntityId(),
      sourceCardId: sa.sourceCardId,
      timestamp,
      layer: Layer.L4_Type,
      duration,
      payload: { kind: "type", effect: typeChange },
    };

    // Layer 7b — set base P/T to the specified values.
    const ptSet: Layer7bEffect = {
      kind: "set",
      power,
      toughness,
      timestamp,
      sourceAbilityId: sa.sourceCardId,
    };
    const ptEffect: ContinuousEffect = {
      id: game.newEntityId(),
      sourceCardId: sa.sourceCardId,
      timestamp,
      layer: Layer.L7b_PTSet,
      duration,
      payload: { kind: "pt-set", effect: ptSet },
    };

    game.continuousEffectRegistry.register(typeEffect);
    game.continuousEffectRegistry.register(ptEffect);
  }
}

effectRegistry.register(AnimateEffect);
