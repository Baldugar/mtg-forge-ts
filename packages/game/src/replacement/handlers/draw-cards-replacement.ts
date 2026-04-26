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
//   ReplaceWith$ <SVar>                          — Wave 17b: when the SVar
//     resolves to an ability on the source card we treat the canonical
//     draw as replaced and return null. The synchronous execution of the
//     alternative ability (mill / scry / damage instead) is plumbed in
//     Wave 18 once the action layer exposes a synchronous SVar dispatcher.
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

export class DrawCardsReplacement extends ReplacementHandler {
  static override readonly eventKind = "DrawCards";

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
        if (intent.kind !== "drawCards") return false;
        const seat = (intent as { seat?: PlayerSeat }).seat;
        if (seat === undefined) return false;
        if (validPlayerRaw === "You") return seat === controllerSeat;
        if (validPlayerRaw === "Opponent") return seat !== controllerSeat;
        if (validPlayerRaw === "Each" || validPlayerRaw === "Player") return true;
        return false;
      },

      apply(intent: MutationIntent, gameUnknown: unknown): MutationIntent | null {
        if (layerParam === "CantHappen" || preventParam === "True") return null;
        // ReplaceWith$ <SVar> — Wave 17b looked up the SVar; Wave 29 wires
        // the synchronous execution. When the SVar dereferences to an
        // ability on the source card, run its resolver in place (drain
        // the generator under the apply() boundary) and treat the
        // canonical draw as replaced (return null). The runner mirrors
        // GameLossReplacement's direct mutation but generalised across
        // any registered effect handler. Decision-yielding effects are
        // skipped — see runReplaceWithAbilitySync's contract.
        if (replaceWithKey !== undefined) {
          const game = gameUnknown as Game;
          const ability = lookupReplaceWithAbility(game, sourceCardId, replaceWithKey);
          if (ability !== null) {
            runReplaceWithAbilitySync(game, sourceCardId, controllerSeat, ability);
            return null;
          }
        }
        return intent;
      },
    };
  }
}

replacementHandlerRegistry.register(DrawCardsReplacement);
