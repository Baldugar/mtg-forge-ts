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
//   ReplaceWith$ <SVar>                          — recorded; SVar dispatch
//     is delegated to Wave 18 (cascade is resolved through a dedicated
//     CascadeTrigger; the alt-resolve path is a separate plumbing change).
import type {
  EntityId,
  MutationIntent,
  PlayerSeat,
  ReplacementAbility,
  ReplacementAst,
} from "@mtg-forge-ts/core";
import { replacementHandlerRegistry } from "../replacement-handler-registry.js";
import type { ReplacementBuildContext } from "../replacement-handler.js";
import { ReplacementHandler } from "../replacement-handler.js";

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

      apply(intent: MutationIntent, _game: unknown): MutationIntent | null {
        if (layerParam === "CantHappen" || preventParam === "True") return null;
        return intent;
      },
    };
  }
}

replacementHandlerRegistry.register(CascadeReplacement);
