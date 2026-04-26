// SPDX-License-Identifier: GPL-3.0-or-later
// MillReplacement — handles Forge's `R:Event$ Mill` replacement line.
// Intercepts mill mutation intents and either prevents them or redirects
// them via SVar (e.g. "if a card would be put into your graveyard from
// your library, exile it instead").
//
// Forge patterns:
//   R:Event$ Mill | ValidPlayer$ You | Layer$ CantHappen
//     | Description$ You can't be milled.
//   R:Event$ Mill | ValidPlayer$ You | Prevent$ True
//     | Description$ If a card would be milled from your library, prevent it.
//   R:Event$ Mill | ValidPlayer$ You | ReplaceWith$ DBExileFromLibrary
//
// Wave 17 MVP support:
//   ValidPlayer$ You / Opponent / Each / Player — seat filter on the milled
//                                                 player.
//   Layer$ CantHappen / Prevent$ True           — prevent the mill.
//   ReplaceWith$ <SVar>                          — Wave 17b: lookup +
//     prevent-canonical when the SVar resolves on the source card. Wave
//     18 wires the actual exile-instead-of-mill execution.
import type { MutationIntent, PlayerSeat, ReplacementAbility, ReplacementAst } from "@mtg-forge-ts/core";
import type { Game } from "../../game.js";
import { replacementHandlerRegistry } from "../replacement-handler-registry.js";
import type { ReplacementBuildContext } from "../replacement-handler.js";
import { ReplacementHandler } from "../replacement-handler.js";
import { lookupReplaceWithAbility } from "./replace-with-svar.js";

const getParamRaw = (ast: ReplacementAst, key: string): string | undefined => {
  const pv = ast.params[key];
  if (!pv) return undefined;
  if (pv.kind === "literal") return pv.raw;
  return undefined;
};

export class MillReplacement extends ReplacementHandler {
  static override readonly eventKind = "Mill";

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
        if (intent.kind !== "mill") return false;
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
          if (ability !== null) return null;
        }
        return intent;
      },
    };
  }
}

replacementHandlerRegistry.register(MillReplacement);
