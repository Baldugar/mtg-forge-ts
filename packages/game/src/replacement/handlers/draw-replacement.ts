// SPDX-License-Identifier: GPL-3.0-or-later
// DrawReplacement — handles Forge's `R:Event$ Draw` replacement line.
// Intercepts draw-card mutation intents (DrawCardsIntent) and either
// redirects them to a different player (Notion Thief / Alms Collector),
// prevents them entirely (Maralen, Hollow Trickster-style), or rewrites
// the count via a multiplier (Sylvan Library uncommon shape).
//
// Forge patterns:
//   R:Event$ Draw | ValidPlayer$ Opponent | ReplaceWith$ DBController
//     | Description$ Notion Thief — if an opponent would draw a card except
//                    the first one each of their draw steps, instead that
//                    player skips that draw and you draw a card.
//   R:Event$ Draw | ValidPlayer$ You | Layer$ CantHappen
//     | Description$ Maralen of the Mornsong — you can't draw cards.
//
// Wave 48 supports:
//   ValidPlayer$ You / Opponent / Each / Player              — seat filter.
//   Layer$ CantHappen / Prevent$ True                        — block the draw.
//   ReplaceWith$ DBController / DBYou                        — redirect to
//                                                              the replacement
//                                                              controller.
//   ReplaceWith$ DBOpponent                                  — redirect to
//                                                              "the other seat".
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

// ---------------------------------------------------------------------------
// DrawReplacement
// ---------------------------------------------------------------------------

export class DrawReplacement extends ReplacementHandler {
  static override readonly eventKind = "Draw";

  override build(ast: ReplacementAst, ctx: ReplacementBuildContext): ReplacementAbility {
    const { sourceCardId, controllerSeat, replacementId } = ctx;
    const validPlayer = getParamRaw(ast, "ValidPlayer") ?? "Player";
    const replaceWith = getParamRaw(ast, "ReplaceWith") ?? ast.effect.handlerKey;
    const layerParam = getParamRaw(ast, "Layer");
    const preventParam = getParamRaw(ast, "Prevent");

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
        const di = intent as { seat?: PlayerSeat };
        if (di.seat === undefined) return false;
        if (validPlayer === "You") return di.seat === controllerSeat;
        if (validPlayer === "Opponent") return di.seat !== controllerSeat;
        if (validPlayer === "Each" || validPlayer === "Player") return true;
        return false;
      },

      apply(intent: MutationIntent, _game: unknown): MutationIntent | null {
        if (layerParam === "CantHappen" || preventParam === "True") return null;
        const di = intent as { seat?: PlayerSeat };
        // ReplaceWith$ DBController / DBYou — redirect to the replacement's
        // controller (Notion Thief / Alms Collector pattern).
        if (replaceWith === "DBController" || replaceWith === "DBYou") {
          return { ...intent, seat: controllerSeat };
        }
        if (replaceWith === "DBOpponent") {
          // Two-player approximation: flip seat to the other player.
          const cur = di.seat ?? controllerSeat;
          const flipped: PlayerSeat = (
            cur === controllerSeat ? (controllerSeat as number) + 1 : controllerSeat
          ) as PlayerSeat;
          return { ...intent, seat: flipped };
        }
        return intent;
      },
    };
  }
}

replacementHandlerRegistry.register(DrawReplacement);
