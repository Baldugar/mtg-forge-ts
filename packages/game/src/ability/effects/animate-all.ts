// SPDX-License-Identifier: GPL-3.0-or-later
// AnimateAllEffect — turns all permanents matching a ValidCards$ filter into
// creatures with specified P/T until end of turn. Like AnimateEffect but applies
// board-wide to all matching permanents.
//
// Forge DSL:
//   SP$ AnimateAll | Cost$ 3 U | ValidCards$ Land.YouCtrl | Power$ 3 | Toughness$ 3
//         | Types$ Creature | Duration$ untilEndOfTurn
//
// Supported ValidCards$ filter tokens (same set as DestroyAll / PumpAll):
//   Creature / Artifact / Enchantment / Land / Permanent
//   + .YouCtrl / .OpponentCtrl qualifiers.
//
// Two layered continuous effects per card (same as AnimateEffect):
//   Layer 4 (type): add CardType.Creature.
//   Layer 7b (PT set): set base P/T.
// Duration: untilEndOfTurn (default) or permanent.
import { CardType, type ContinuousEffect, Layer, ZoneType } from "@mtg-forge-ts/core";
import type { EntityId } from "@mtg-forge-ts/core";
import type { EngineYield } from "../../action/engine-yield.js";
import type { Game } from "../../game.js";
import type { TypeChangeEffect } from "../../layers/layer4-type.js";
import type { Layer7bEffect } from "../../layers/layer7-pt.js";
import { effectRegistry } from "../effect-registry.js";
import { evaluateParamNumber, evaluateParamRaw, hasParam } from "../evaluate-param.js";
import { SpellAbilityEffect } from "../spell-ability-effect.js";
import type { SpellAbility } from "../spell-ability.js";

/** Collect all card ids on the battlefield matching the ValidCards$ filter. */
function collectMatching(sa: SpellAbility, game: Game): EntityId[] {
  const filterRaw = hasParam(sa, "ValidCards") ? evaluateParamRaw(sa, "ValidCards") : "Permanent";
  const tokens = filterRaw.split(".").map((t) => t.trim().toLowerCase());
  const baseType = tokens[0] ?? "permanent";
  const qualifier = tokens[1] ?? "";

  const matched: EntityId[] = [];
  for (const [id, card] of game.cards) {
    // Zone guard: AnimateAll targets battlefield permanents only (CR 700.7).
    if (card.zone !== ZoneType.Battlefield) continue;

    const chars = game.layerEngine.computeCharacteristics(id);

    if (baseType !== "permanent" && baseType !== "card") {
      if (baseType === "creature" && !chars.types.has(CardType.Creature)) continue;
      if (baseType === "artifact" && !chars.types.has(CardType.Artifact)) continue;
      if (baseType === "enchantment" && !chars.types.has(CardType.Enchantment)) continue;
      if (baseType === "land" && !chars.types.has(CardType.Land)) continue;
    }

    if (qualifier === "youctrl" && card.controllerSeat !== sa.controllerSeat) continue;
    if (qualifier === "opponentctrl" && card.controllerSeat === sa.controllerSeat) continue;

    matched.push(id);
  }
  return matched;
}

export class AnimateAllEffect extends SpellAbilityEffect {
  static override readonly handlerKey = "AnimateAll";

  // biome-ignore lint/correctness/useYield: ContinuousEffectRegistry.register is synchronous — no EngineYield to emit
  override *resolve(sa: SpellAbility, game: Game): Generator<EngineYield, void, unknown> {
    const power = hasParam(sa, "Power") ? evaluateParamNumber(sa, "Power", game) : 0;
    const toughness = hasParam(sa, "Toughness") ? evaluateParamNumber(sa, "Toughness", game) : 0;

    const durationRaw = hasParam(sa, "Duration") ? evaluateParamRaw(sa, "Duration") : "untilEndOfTurn";
    const duration: ContinuousEffect["duration"] =
      durationRaw.toLowerCase() === "permanent" ? { kind: "permanent" } : { kind: "untilEndOfTurn" };

    const matchingIds = collectMatching(sa, game);

    for (const targetId of matchingIds) {
      const timestamp: number = game.newEntityId();

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

      // Use targetId to avoid unused-variable warning — effects are scoped globally in MVP.
      void targetId;
    }
  }
}

effectRegistry.register(AnimateAllEffect);
