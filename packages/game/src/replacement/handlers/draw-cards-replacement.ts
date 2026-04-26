// SPDX-License-Identifier: GPL-3.0-or-later
// DrawCardsReplacement — handles Forge's `R:Event$ DrawCards` replacement
// line. Sister event to the simpler `Draw` (single card) replacement: the
// "DrawCards" form fires whenever a player would draw any number of cards
// and is the canonical Forge name for skip-draw / mill-instead-of-drawing
// effects.
//
// Forge patterns:
//   R:Event$ DrawCards | ValidPlayer$ You | Layer$ CantHappen
//     | Description$ You skip your next draw step.
//   R:Event$ DrawCards | ValidPlayer$ You | ReplaceWith$ DBMillTwo
//     | Description$ If you would draw a card, mill two cards instead.
//   R:Event$ DrawCards | ValidPlayer$ Opponent | Prevent$ True
//     | Description$ Opponents can't draw cards.
//
// Wave 17 MVP support:
//   ValidPlayer$ You / Opponent / Each / Player — seat filter.
//   Layer$ CantHappen / Prevent$ True           — prevent draw entirely.
//   ReplaceWith$ <SVar>                          — recorded; runtime
//     dispatch through SVar abilities is delegated to Wave 18 once
//     game.action.draw routes recognised SVars through the engine.
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

export class DrawCardsReplacement extends ReplacementHandler {
  static override readonly eventKind = "DrawCards";

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
        if (intent.kind !== "drawCards") return false;
        const seat = (intent as { seat?: PlayerSeat }).seat;
        if (seat === undefined) return false;
        if (validPlayerRaw === "You") return seat === controllerSeat;
        if (validPlayerRaw === "Opponent") return seat !== controllerSeat;
        if (validPlayerRaw === "Each" || validPlayerRaw === "Player") return true;
        return false;
      },

      apply(intent: MutationIntent, _game: unknown): MutationIntent | null {
        if (layerParam === "CantHappen" || preventParam === "True") return null;
        // ReplaceWith$ <SVar> — Wave 18 will resolve SVar to a mill / scry
        // alternative ability. Until then, fall through unchanged so the
        // canonical draw still happens (no half-resolution).
        void sourceCardId;
        return intent;
      },
    };
  }
}

replacementHandlerRegistry.register(DrawCardsReplacement);
