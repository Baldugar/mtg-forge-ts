// SPDX-License-Identifier: GPL-3.0-or-later
// PutCounterAllEffect — adds N counters of a given type to all permanents
// matching a ValidCards$ filter. Board-wide counter addition (14 cards).
//
// Forge DSL:
//   SP$ PutCounterAll | ValidCards$ Creature.YouCtrl | CounterType$ P1P1 | CounterNum$ 1
//   SP$ PutCounterAll | ValidCards$ Creature | CounterType$ M1M1 | CounterNum$ 1
//
// Forge counter code mapping to CounterType enum values:
//   P1P1  → CounterType.PlusOnePlusOne  ("+1/+1")
//   M1M1  → CounterType.MinusOneMinusOne ("-1/-1")
//   All other names → lowercase-matched to enum values (charge, lore, etc.)
//
// ValidCards$ filter: same token convention as DestroyAll / ChangeZoneAll:
//   Creature           — any Creature on battlefield
//   Creature.YouCtrl   — Creature controlled by sa.controllerSeat
//   Creature.OpponentCtrl — Creature NOT controlled by sa.controllerSeat
//   Artifact           — any Artifact on battlefield
//   Enchantment        — any Enchantment on battlefield
//   Land               — any Land on battlefield
//   Permanent          — any permanent on battlefield
//
// Counters are collected first, then added — consistent with simultaneous-
// apply semantics (all modifications happen before any triggers fire).
import { CardType, CounterType, ZoneType } from "@mtg-forge-ts/core";
import type { EntityId } from "@mtg-forge-ts/core";
import type { EngineYield } from "../../action/engine-yield.js";
import type { Game } from "../../game.js";
import { effectRegistry } from "../effect-registry.js";
import { evaluateParamNumber, evaluateParamRaw, hasParam } from "../evaluate-param.js";
import { SpellAbilityEffect } from "../spell-ability-effect.js";
import type { SpellAbility } from "../spell-ability.js";

/** Map Forge DSL counter codes to CounterType enum values. */
function resolveCounterType(raw: string): CounterType {
  // Forge uses "P1P1" and "M1M1" as shorthands.
  if (raw === "P1P1") return CounterType.PlusOnePlusOne;
  if (raw === "M1M1") return CounterType.MinusOneMinusOne;
  // For all other values, try to match by enum value (lowercase string comparison).
  const lower = raw.toLowerCase();
  for (const value of Object.values(CounterType)) {
    if (typeof value === "string" && value.toLowerCase() === lower) {
      return value as CounterType;
    }
  }
  // Fall back: cast raw as CounterType (addCounter will reject invalid values at runtime).
  return raw as CounterType;
}

/** Collect all card ids on the battlefield matching the ValidCards$ filter. */
function collectMatching(sa: SpellAbility, game: Game): EntityId[] {
  const filterRaw = hasParam(sa, "ValidCards") ? evaluateParamRaw(sa, "ValidCards") : "Creature";
  const tokens = filterRaw.split(".").map((t) => t.trim().toLowerCase());
  const baseType = tokens[0] ?? "creature";
  const qualifier = tokens[1] ?? "";

  const matched: EntityId[] = [];
  for (const [id, card] of game.cards) {
    // Zone guard: PutCounterAll targets battlefield permanents only (CR 700.7).
    if (card.zone !== ZoneType.Battlefield) continue;

    const chars = game.layerEngine.computeCharacteristics(id);

    // Base-type filter.
    if (baseType !== "permanent") {
      if (baseType === "creature" && !chars.types.has(CardType.Creature)) continue;
      if (baseType === "artifact" && !chars.types.has(CardType.Artifact)) continue;
      if (baseType === "enchantment" && !chars.types.has(CardType.Enchantment)) continue;
      if (baseType === "land" && !chars.types.has(CardType.Land)) continue;
    }

    // Controller qualifier.
    if (qualifier === "youctrl" && card.controllerSeat !== sa.controllerSeat) continue;
    if (qualifier === "opponentctrl" && card.controllerSeat === sa.controllerSeat) continue;

    matched.push(id);
  }
  return matched;
}

export class PutCounterAllEffect extends SpellAbilityEffect {
  static override readonly handlerKey = "PutCounterAll";

  override *resolve(sa: SpellAbility, game: Game): Generator<EngineYield, void, unknown> {
    const counterTypeRaw = hasParam(sa, "CounterType") ? evaluateParamRaw(sa, "CounterType") : "P1P1";
    const counterType = resolveCounterType(counterTypeRaw);
    const num = hasParam(sa, "CounterNum") ? evaluateParamNumber(sa, "CounterNum", game) : 1;

    // Collect targets first (simultaneous-add semantics).
    const targets = collectMatching(sa, game);

    for (const cardId of targets) {
      yield* game.action.addCounter(cardId, counterType, num, sa.sourceCardId);
    }
  }
}

effectRegistry.register(PutCounterAllEffect);
