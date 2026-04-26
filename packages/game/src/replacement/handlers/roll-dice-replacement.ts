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
//   ReplaceWith$ <SVar>                          — recorded; SVar dispatch
//     is delegated to Wave 18 once RollDiceEffect routes a recognised SVar
//     pattern through the engine.
import type { MutationIntent, PlayerSeat, ReplacementAbility, ReplacementAst } from "@mtg-forge-ts/core";
import { replacementHandlerRegistry } from "../replacement-handler-registry.js";
import type { ReplacementBuildContext } from "../replacement-handler.js";
import { ReplacementHandler } from "../replacement-handler.js";

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
    void getParamRaw(ast, "ReplaceWith");
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

      apply(intent: MutationIntent, _game: unknown): MutationIntent | null {
        if (layerParam === "CantHappen" || preventParam === "True") return null;
        void sourceCardId;
        return intent;
      },
    };
  }
}

replacementHandlerRegistry.register(RollDiceReplacement);
