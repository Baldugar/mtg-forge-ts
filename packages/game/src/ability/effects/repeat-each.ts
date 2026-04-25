// SPDX-License-Identifier: GPL-3.0-or-later
// RepeatEachEffect — for each matching player or card, run a sub-ability.
// Used for cards that repeat an effect for each player, each creature, etc.
//
// Forge DSL:
//   DB$ RepeatEach | RepeatPlayers$ Each | RepeatSubAbility$ DBDamage
//   DB$ RepeatEach | RepeatCards$ Permanent.YouCtrl | RepeatSubAbility$ DBPump
//
// MVP implementation:
//   - RepeatPlayers$ Each/You/Opponent — iterate over matching player seats
//     and run the sub-ability from the SVar named by RepeatSubAbility$.
//   - RepeatCards$ <filter> — iterate over matching cards (uses same filter
//     tokens as DestroyAll).
//   - Sub-ability is looked up from the source card's SVars at resolve time.
//
// TODO(Wave 9): pass the iterated subject (seat/cardId) into the sub-ability
// context so effects like "deal 1 damage to each creature" can target the
// right subject. Current MVP runs the sub-ability once per match but the
// sub-ability's Defined$ context is not yet overridden per-iteration.
import { CardType } from "@mtg-forge-ts/core";
import type { AbilityAst, EntityId, SVarAst } from "@mtg-forge-ts/core";
import type { EngineYield } from "../../action/engine-yield.js";
import type { Game } from "../../game.js";
import { effectRegistry } from "../effect-registry.js";
import { evaluateParamRaw, hasParam } from "../evaluate-param.js";
import { SpellAbilityEffect } from "../spell-ability-effect.js";
import { SpellAbility } from "../spell-ability.js";

export class RepeatEachEffect extends SpellAbilityEffect {
  static override readonly handlerKey = "RepeatEach";

  override *resolve(sa: SpellAbility, game: Game): Generator<EngineYield, void, unknown> {
    const subAbilityKey = hasParam(sa, "RepeatSubAbility") ? evaluateParamRaw(sa, "RepeatSubAbility") : null;
    if (!subAbilityKey) return;

    const sourceCard = game.cards.get(sa.sourceCardId);
    if (!sourceCard?.paperCard.definition) return;
    const svars = sourceCard.paperCard.definition.svars as ReadonlyMap<string, SVarAst>;
    const sv = svars.get(subAbilityKey);
    if (!sv || sv.kind !== "ability" || !sv.ability) return;

    // Build the sub-ability SpellAbility.
    const fakeAst: AbilityAst = {
      kind: "spell",
      effect: sv.ability,
      cost: { raw: "" },
    };

    // Determine iteration count.
    let iterCount = 0;

    if (hasParam(sa, "RepeatPlayers")) {
      const repeatPlayers = evaluateParamRaw(sa, "RepeatPlayers").toLowerCase();
      for (const player of game.players) {
        if (repeatPlayers === "each") iterCount++;
        else if (repeatPlayers === "you" && player.seat === sa.controllerSeat) iterCount++;
        else if (repeatPlayers === "opponent" && player.seat !== sa.controllerSeat) iterCount++;
      }
    } else if (hasParam(sa, "RepeatCards")) {
      const filterRaw = evaluateParamRaw(sa, "RepeatCards");
      const tokens = filterRaw.split(".").map((t) => t.trim().toLowerCase());
      const baseType = tokens[0] ?? "card";
      const qualifier = tokens[1] ?? "";

      for (const [id, card] of game.cards) {
        const chars = game.layerEngine.computeCharacteristics(id);
        if (baseType !== "permanent" && baseType !== "card") {
          if (baseType === "creature" && !chars.types.has(CardType.Creature)) continue;
          if (baseType === "artifact" && !chars.types.has(CardType.Artifact)) continue;
          if (baseType === "enchantment" && !chars.types.has(CardType.Enchantment)) continue;
          if (baseType === "land" && !chars.types.has(CardType.Land)) continue;
        }
        if (qualifier === "youctrl" && card.controllerSeat !== sa.controllerSeat) continue;
        if (qualifier === "opponentctrl" && card.controllerSeat === sa.controllerSeat) continue;
        iterCount++;
      }
    } else {
      // Default: run once.
      iterCount = 1;
    }

    // Run the sub-ability once per match.
    for (let i = 0; i < iterCount; i++) {
      const subSa = new SpellAbility(fakeAst, sa.sourceCardId, sa.controllerSeat, svars, [] as EntityId[]);
      const resolver = subSa.makeResolver();
      // Cast through unknown to EngineYield — the inner generator yields EngineYield at runtime;
      // StackItemResolver.resolve() types it as Generator<unknown> to avoid a circular import.
      yield* resolver.resolve(game) as Generator<EngineYield, void, unknown>;
    }
  }
}

effectRegistry.register(RepeatEachEffect);
