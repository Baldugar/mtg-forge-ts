// SPDX-License-Identifier: GPL-3.0-or-later
// ChooseCardEffect — picks N cards from a filtered set and remembers them
// on the source card.
//
// Forge DSL:
//   SP$ ChooseCard | Choices$ Card.YouCtrl | NumChoices$ 1 | RememberChosen$ True
//   SP$ ChooseCard | Choices$ Creature.YouCtrl | NumChoices$ 2
//
// MVP implementation: the engine does not yet have a `chooseCards` interactive
// decision kind in the core decisions schema, so we deterministically pick the
// first N candidates (stable ordering by EntityId). An interactive decision
// yield will be wired in when the decision type is added in SP3.
//
// The chosen EntityIds are appended to `source.remembered` when
// `RememberChosen$ True` is present (or absent — remember is the default for
// ChooseCard effects in Forge).
import { CardType, ZoneType } from "@mtg-forge-ts/core";
import type { EntityId } from "@mtg-forge-ts/core";
import type { EngineYield } from "../../action/engine-yield.js";
import type { Game } from "../../game.js";
import { effectRegistry } from "../effect-registry.js";
import { evaluateParamNumber, evaluateParamRaw, hasParam } from "../evaluate-param.js";
import { SpellAbilityEffect } from "../spell-ability-effect.js";
import type { SpellAbility } from "../spell-ability.js";

/** Collect cards matching the Choices$ filter. Reuses the same token
 *  convention as DestroyAll / ChangeZoneAll: "Type.Qualifier". */
function collectMatching(game: Game, sa: SpellAbility, filterRaw: string): EntityId[] {
  const tokens = filterRaw.split(".").map((t) => t.trim().toLowerCase());
  const baseType = tokens[0] ?? "card";
  const qualifier = tokens[1] ?? "";

  const matched: EntityId[] = [];
  for (const [id, card] of game.cards) {
    // Zone guard: ChooseCard picks from battlefield permanents (CR 700.7).
    if (card.zone !== ZoneType.Battlefield) continue;

    const chars = game.layerEngine.computeCharacteristics(id);

    // Base-type filter ("card" = any permanent).
    if (baseType !== "card" && baseType !== "permanent") {
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

export class ChooseCardEffect extends SpellAbilityEffect {
  static override readonly handlerKey = "ChooseCard";

  // Non-generator: ChooseCard mutates card.remembered synchronously for MVP
  // (interactive choose deferred to SP3). Returns an empty generator to satisfy
  // Generator<EngineYield,void,unknown> return type.
  override resolve(sa: SpellAbility, game: Game): Generator<EngineYield, void, unknown> {
    const choicesRaw = hasParam(sa, "Choices") ? evaluateParamRaw(sa, "Choices") : "Card";
    const num = hasParam(sa, "NumChoices") ? evaluateParamNumber(sa, "NumChoices", game) : 1;
    const candidates = collectMatching(game, sa, choicesRaw);

    // Deterministic pick: first N candidates by insertion order. Interactive
    // chooseCards decision deferred to SP3 (no decision kind in core yet).
    const chosen = candidates.slice(0, num);

    // Store on source card's remembered list (default behaviour matches Forge).
    const source = game.cards.get(sa.sourceCardId);
    if (source) {
      source.remembered.push(...chosen);
    }

    return (function* (): Generator<EngineYield, void, unknown> {
      /* no engine events emitted for this synchronous operation */
    })();
  }
}

effectRegistry.register(ChooseCardEffect);
