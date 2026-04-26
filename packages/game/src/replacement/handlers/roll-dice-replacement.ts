// SPDX-License-Identifier: GPL-3.0-or-later
// RollDiceReplacement — handles Forge's `R:Event$ RollDice` replacement
// line. Used by cards that alter die rolls (re-roll lowest, swap result,
// roll twice and pick higher).
//
// Forge patterns:
//   R:Event$ RollDice | ValidPlayer$ You | Layer$ CantHappen
//     | Description$ You can't roll dice.
//   R:Event$ RollDice | ValidPlayer$ You | ReplaceWith$ DBRerollTakeHigher
//     | Description$ If you would roll a die, roll twice and use the higher.
//
// Wave 17 MVP support:
//   ValidPlayer$ You / Opponent / Each / Player — seat filter on the rolling
//                                                 player.
//   Layer$ CantHappen / Prevent$ True           — block the roll entirely.
//   ReplaceWith$ <SVar>                          — Wave 17b: lookup +
//     prevent-canonical when the SVar resolves on the source card. Wave
//     18 will execute the alternative roll synchronously here.
import type { MutationIntent, PlayerSeat, ReplacementAbility, ReplacementAst } from "@mtg-forge-ts/core";
import type { Game } from "../../game.js";
import { replacementHandlerRegistry } from "../replacement-handler-registry.js";
import type { ReplacementBuildContext } from "../replacement-handler.js";
import { ReplacementHandler } from "../replacement-handler.js";
import { lookupReplaceWithAbility, runReplaceWithAbilitySync } from "./replace-with-svar.js";

const getParamRaw = (ast: ReplacementAst, key: string): string | undefined => {
  const pv = ast.params[key];
  if (!pv) return undefined;
  if (pv.kind === "literal") return pv.raw;
  return undefined;
};

export class RollDiceReplacement extends ReplacementHandler {
  static override readonly eventKind = "RollDice";

  override build(ast: ReplacementAst, ctx: ReplacementBuildContext): ReplacementAbility {
    const validPlayerRaw = getParamRaw(ast, "ValidPlayer") ?? "Player";
    const layerParam = getParamRaw(ast, "Layer");
    const preventParam = getParamRaw(ast, "Prevent");
    const replaceWithKey = getParamRaw(ast, "ReplaceWith");
    const { sourceCardId, controllerSeat, replacementId } = ctx;

    return {
      id: replacementId,
      kind: "replacement",
      sourceCardId,
      activeInZones: new Set(["Battlefield" as never]),
      timestamp: 0,
      controllerSeatAtReg: controllerSeat,
      isSelfReplacement: ast.isSelf === true,
      layer: layerParam === "CantHappen" ? "cantHappen" : "other",

      matches(intent: MutationIntent): boolean {
        if (intent.kind !== "rollDice") return false;
        const seat = (intent as { seat?: PlayerSeat }).seat;
        if (seat === undefined) return false;
        if (validPlayerRaw === "You") return seat === controllerSeat;
        if (validPlayerRaw === "Opponent") return seat !== controllerSeat;
        if (validPlayerRaw === "Each" || validPlayerRaw === "Player") return true;
        return false;
      },

      apply(intent: MutationIntent, gameUnknown: unknown): MutationIntent | null {
        if (layerParam === "CantHappen" || preventParam === "True") return null;
        if (replaceWithKey !== undefined) {
          const game = gameUnknown as Game;
          const ability = lookupReplaceWithAbility(game, sourceCardId, replaceWithKey);
          if (ability !== null) {
            // Wave 29 — execute the substituted roll variant synchronously
            // (re-roll, take higher of two, etc.).
            runReplaceWithAbilitySync(game, sourceCardId, controllerSeat, ability);
            return null;
          }
        }
        return intent;
      },
    };
  }
}

replacementHandlerRegistry.register(RollDiceReplacement);
