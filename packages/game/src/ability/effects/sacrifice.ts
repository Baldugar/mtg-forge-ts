// SPDX-License-Identifier: GPL-3.0-or-later
// SacrificeEffect — sacrifices target permanent(s) (CR 701.16).
//
// Wave 53 broadens the MVP:
//   - Amount$ <N>             — sacrifice up to N from a SacValid$ pool
//                               (defaults to using sa.targets).
//   - SacValid$ <filter>      — when sa.targets is empty, the filter narrows
//                               candidates from controller's battlefield.
//                               Vocabulary mirrors EachValid$ in PutCounter:
//                               `Creature` / `Artifact` / `Enchantment` /
//                               `Land` / `Permanent` plus `.YouCtrl` qualifier.
//   - Mandatory$ True         — controller MUST pick (MVP: pick first N).
//   - Optional$ True          — controller MAY skip (MVP: still picks; the
//                               flag is preserved for the future decision
//                               subsystem to interpret).
//   - RememberSacrificed$ True — push sacrificed card ids into source's
//                                `remembered` slot.
import type { EntityId } from "@mtg-forge-ts/core";
import { CardType, ZoneType } from "@mtg-forge-ts/core";
import type { EngineYield } from "../../action/engine-yield.js";
import type { Game } from "../../game.js";
import { effectRegistry } from "../effect-registry.js";
import { evaluateParamNumber, evaluateParamRaw, hasParam } from "../evaluate-param.js";
import { SpellAbilityEffect } from "../spell-ability-effect.js";
import type { SpellAbility } from "../spell-ability.js";

const isTrue = (raw: string | undefined): boolean => raw !== undefined && raw.trim().toLowerCase() === "true";

function collectSacValid(filter: string, sa: SpellAbility, game: Game): readonly EntityId[] {
  const tokens = filter.split(".").map((t) => t.trim().toLowerCase());
  const baseType = tokens[0] ?? "permanent";
  const qualifier = tokens[1] ?? "youctrl"; // sacrifice is owner-scoped by default

  const matched: EntityId[] = [];
  for (const [id, card] of game.cards) {
    if (card.zone !== ZoneType.Battlefield) continue;
    const chars = game.layerEngine.computeCharacteristics(id);
    if (baseType !== "permanent") {
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

export class SacrificeEffect extends SpellAbilityEffect {
  static override readonly handlerKey = "Sacrifice";
  override *resolve(sa: SpellAbility, game: Game): Generator<EngineYield, void, unknown> {
    let toSacrifice: readonly EntityId[] = sa.targets;

    if (toSacrifice.length === 0 && hasParam(sa, "SacValid")) {
      const filter = evaluateParamRaw(sa, "SacValid");
      const candidates = collectSacValid(filter, sa, game);
      const amount = hasParam(sa, "Amount") ? evaluateParamNumber(sa, "Amount", game) : 1;
      const optional = isTrue(hasParam(sa, "Optional") ? evaluateParamRaw(sa, "Optional") : undefined);
      const mandatory = isTrue(hasParam(sa, "Mandatory") ? evaluateParamRaw(sa, "Mandatory") : undefined);
      // Optional$ True without Mandatory$ True → still pick for MVP, but
      // capped to candidates.length so we never exceed the pool.
      void optional;
      void mandatory;
      toSacrifice = candidates.slice(0, Math.min(amount, candidates.length));
    } else if (hasParam(sa, "Amount")) {
      const amount = evaluateParamNumber(sa, "Amount", game);
      toSacrifice = toSacrifice.slice(0, Math.max(0, amount));
    }

    const stampRemembered = isTrue(
      hasParam(sa, "RememberSacrificed") ? evaluateParamRaw(sa, "RememberSacrificed") : undefined,
    );

    for (const targetId of toSacrifice) {
      yield* game.action.sacrifice(targetId, { sourceId: sa.sourceCardId });
      if (stampRemembered) {
        const src = game.cards.get(sa.sourceCardId);
        if (src && !src.remembered.includes(targetId)) {
          src.remembered.push(targetId);
        }
      }
    }
  }
}

effectRegistry.register(SacrificeEffect);
