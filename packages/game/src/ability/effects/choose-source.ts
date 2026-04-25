// SPDX-License-Identifier: GPL-3.0-or-later
// ChooseSourceEffect — picks a "damage source" card from a filtered set and
// remembers it on the source card. Used to name a source for damage prevention
// (Circle of Protection effects, True Believer, etc.).
//
// Forge DSL:
//   DB$ ChooseSource | Choices$ Card.OpponentCtrl | RememberChosen$ True
//   DB$ ChooseSource | Choices$ Spell | RememberChosen$ True
//
// MVP: identical mechanics to ChooseCardEffect (same filter token convention,
// same deterministic "pick first N" selection, same remembered[] storage).
// The semantic difference (choosing a damage *source* vs. a target card) is
// a rules layer concern tracked separately. Interactive chooseSource decision
// deferred to SP3.
import { CardType, ZoneType } from "@mtg-forge-ts/core";
import type { EntityId } from "@mtg-forge-ts/core";
import type { EngineYield } from "../../action/engine-yield.js";
import type { Game } from "../../game.js";
import { effectRegistry } from "../effect-registry.js";
import { evaluateParamNumber, evaluateParamRaw, hasParam } from "../evaluate-param.js";
import { SpellAbilityEffect } from "../spell-ability-effect.js";
import type { SpellAbility } from "../spell-ability.js";

/** Collect cards matching the Choices$ filter. Same token convention as
 *  DestroyAll / ChooseCard: "Type.Qualifier". */
function collectMatching(game: Game, sa: SpellAbility, filterRaw: string): EntityId[] {
  const tokens = filterRaw.split(".").map((t) => t.trim().toLowerCase());
  const baseType = tokens[0] ?? "card";
  const qualifier = tokens[1] ?? "";

  const matched: EntityId[] = [];
  for (const [id, card] of game.cards) {
    // Zone guard: ChooseSource picks from battlefield permanents (CR 700.7).
    // "spell" baseType is special — on-stack objects; we still default to
    // battlefield for MVP since stack searching is not yet modelled.
    if (card.zone !== ZoneType.Battlefield) continue;

    const chars = game.layerEngine.computeCharacteristics(id);

    // Base-type filter ("card" = any permanent).
    if (baseType !== "card" && baseType !== "permanent" && baseType !== "spell") {
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

export class ChooseSourceEffect extends SpellAbilityEffect {
  static override readonly handlerKey = "ChooseSource";

  // Non-generator: ChooseSource mutates card.remembered synchronously for MVP.
  override resolve(sa: SpellAbility, game: Game): Generator<EngineYield, void, unknown> {
    const choicesRaw = hasParam(sa, "Choices") ? evaluateParamRaw(sa, "Choices") : "Card";
    const num = hasParam(sa, "NumChoices") ? evaluateParamNumber(sa, "NumChoices", game) : 1;
    const candidates = collectMatching(game, sa, choicesRaw);

    // Deterministic pick: first N candidates by insertion order.
    const chosen = candidates.slice(0, num);

    // Store on source card's remembered list.
    const source = game.cards.get(sa.sourceCardId);
    if (source) {
      source.remembered.push(...chosen);
    }

    return (function* (): Generator<EngineYield, void, unknown> {
      /* no engine events emitted for this synchronous MVP operation */
    })();
  }
}

effectRegistry.register(ChooseSourceEffect);
