// SPDX-License-Identifier: GPL-3.0-or-later
// CascadeReplacement — handles Forge's `R:Event$ Cascade` replacement line.
// Niche but real: a small set of Forge cards replace the cascade trigger
// (e.g. cards that double cascade or alter the exile-and-cast portion).
//
// Forge patterns:
//   R:Event$ Cascade | ValidPlayer$ You | Layer$ CantHappen
//     | Description$ You can't cascade.
//   R:Event$ Cascade | ValidPlayer$ You | ReplaceWith$ DBCascadeTwice
//     | Description$ Whenever you cascade, cascade twice.
//
// Wave 17 MVP support:
//   ValidPlayer$ You / Opponent / Each / Player — seat filter on the
//                                                 cascading player.
//   Layer$ CantHappen / Prevent$ True           — block the cascade.
//   ReplaceWith$ <SVar>                          — Wave 17b: lookup +
//     prevent-canonical when the SVar resolves to an ability on the
//     source card. The actual alternate cascade (cascade twice) is
//     plumbed in Wave 18 once cascade has a synchronous SVar entry point.
import type {
  EntityId,
  MutationIntent,
  PlayerSeat,
  ReplacementAbility,
  ReplacementAst,
} from "@mtg-forge-ts/core";
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

export class CascadeReplacement extends ReplacementHandler {
  static override readonly eventKind = "Cascade";

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
        if (intent.kind !== "cascade") return false;
        // CascadeIntent uses `seat` for the cascading player.
        const ci = intent as { seat?: PlayerSeat; sourceId?: EntityId };
        const seat = ci.seat;
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
            // Wave 29 — execute the substituted cascade variant
            // synchronously (cascade twice, alter exile-cast count, etc.).
            runReplaceWithAbilitySync(game, sourceCardId, controllerSeat, ability);
            return null;
          }
        }
        return intent;
      },
    };
  }
}

replacementHandlerRegistry.register(CascadeReplacement);
