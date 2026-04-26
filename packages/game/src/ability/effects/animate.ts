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
// Wave 53 broadens the duration vocabulary:
//   Duration$ tokens: untilEndOfTurn (default), permanent, MyNextTurn /
//                     UntilEndOfYourNextTurn, EndOfCombat.
// Plus:
//   - RememberObjects$ True   — push the animated card id into source's
//                               `remembered` slot.
//
// Layer scoping note: both effects are registered globally (they apply when
// computing ANY card's characteristics). This is the current MVP behavior
// matching the existing Layer 4 / Layer 7b infrastructure which does not yet
// carry a targetCardId filter. A Mishra's Factory-style test works correctly
// because there is only one candidate card in scope at resolution time.
import type { ContinuousEffect, EffectDuration, EntityId } from "@mtg-forge-ts/core";
import { CardType, Layer } from "@mtg-forge-ts/core";
import type { EngineYield } from "../../action/engine-yield.js";
import type { Game } from "../../game.js";
import type { TypeChangeEffect } from "../../layers/layer4-type.js";
import type { Layer7bEffect } from "../../layers/layer7-pt.js";
import { effectRegistry } from "../effect-registry.js";
import { evaluateParamNumber, evaluateParamRaw, hasParam } from "../evaluate-param.js";
import { SpellAbilityEffect } from "../spell-ability-effect.js";
import type { SpellAbility } from "../spell-ability.js";

const isTrue = (raw: string | undefined): boolean => raw !== undefined && raw.trim().toLowerCase() === "true";

function resolveDuration(sa: SpellAbility, game: Game): EffectDuration {
  if (!hasParam(sa, "Duration")) return { kind: "untilEndOfTurn" };
  const tok = evaluateParamRaw(sa, "Duration").trim();
  switch (tok.toLowerCase()) {
    case "permanent":
      return { kind: "permanent" };
    case "untilendofturn":
      return { kind: "untilEndOfTurn" };
    case "endofcombat":
    case "untilendofcombat":
      return { kind: "untilCombatEnds" };
    case "mynextturn":
    case "untilmynextturn":
    case "untilendofyournextturn":
      return {
        kind: "untilEndOfYourNextTurn",
        forSeat: sa.controllerSeat,
        registeredAtTurn: game.turn,
      };
    default:
      return { kind: "untilEndOfTurn" };
  }
}

export class AnimateEffect extends SpellAbilityEffect {
  static override readonly handlerKey = "Animate";

  // biome-ignore lint/correctness/useYield: ContinuousEffectRegistry.register is synchronous — no EngineYield to emit
  override *resolve(sa: SpellAbility, game: Game): Generator<EngineYield, void, unknown> {
    const power = hasParam(sa, "Power") ? evaluateParamNumber(sa, "Power", game) : 0;
    const toughness = hasParam(sa, "Toughness") ? evaluateParamNumber(sa, "Toughness", game) : 0;

    const duration = resolveDuration(sa, game);

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

    // Wave 53 — RememberObjects$ True stamps the animated card on source.
    if (isTrue(hasParam(sa, "RememberObjects") ? evaluateParamRaw(sa, "RememberObjects") : undefined)) {
      const src = game.cards.get(sa.sourceCardId);
      if (src) {
        const ids: readonly EntityId[] = sa.targets.length > 0 ? sa.targets : [sa.sourceCardId];
        for (const id of ids) {
          if (!src.remembered.includes(id)) src.remembered.push(id);
        }
      }
    }
  }
}

effectRegistry.register(AnimateEffect);
