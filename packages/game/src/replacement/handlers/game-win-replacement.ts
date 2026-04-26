// SPDX-License-Identifier: GPL-3.0-or-later
// GameWinReplacement — handles Forge's `R:Event$ GameWin` replacement line.
// Intercepts a "player wins the game" mutation intent and can prevent it
// (Platinum Angel: "your opponents can't win the game").
//
// Forge patterns:
//   R:Event$ GameWin | ActiveZones$ Battlefield | ValidPlayer$ Opponent | Layer$ CantHappen
//     | Secondary$ True | Description$ Your opponents can't win the game.
//
// MVP support mirrors GameLossReplacement: ValidPlayer$ filtering by
// You/Opponent/Each/Player, Layer$ CantHappen and Prevent$ True both
// fully prevent the win, ReplaceWith$ <SVar> deferred to SP4.
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

export class GameWinReplacement extends ReplacementHandler {
  static override readonly eventKind = "GameWin";

  override build(ast: ReplacementAst, ctx: ReplacementBuildContext): ReplacementAbility {
    const validPlayerRaw = getParamRaw(ast, "ValidPlayer") ?? "Player";
    const layerParam = getParamRaw(ast, "Layer");
    const preventParam = getParamRaw(ast, "Prevent");
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
        if (intent.kind !== "gameWin") return false;
        const winningSeat = (intent as { seat?: PlayerSeat }).seat;
        if (winningSeat === undefined) return false;
        if (validPlayerRaw === "You") return winningSeat === controllerSeat;
        if (validPlayerRaw === "Opponent") return winningSeat !== controllerSeat;
        if (validPlayerRaw === "Each" || validPlayerRaw === "Player") return true;
        return false;
      },

      apply(intent: MutationIntent, _game: unknown): MutationIntent | null {
        if (layerParam === "CantHappen" || preventParam === "True") return null;
        return intent;
      },
    };
  }
}

replacementHandlerRegistry.register(GameWinReplacement);
