// SPDX-License-Identifier: GPL-3.0-or-later
// TurnFaceUpReplacement — handles Forge's `R:Event$ TurnFaceUp` replacement line.
// Intercepts a card being turned face-up and can prevent or modify the event.
//
// Forge patterns:
//   R:Event$ TurnFaceUp | ValidCard$ Card.Self | Layer$ CantHappen
//     | Description$ ~ can't be turned face up.
//   R:Event$ TurnFaceUp | ValidCard$ Card.Self | Prevent$ True
//     | Description$ ~ can't be turned face up.
//
// MVP STATUS: Layer$ CantHappen or Prevent$ True returns null (prevents the
// turn-face-up). Other cases pass through unchanged.
//
// The intent kind is "turnFaceUp" — matches on that intent kind with optional
// card filtering via ValidCard$.
import type { EntityId, MutationIntent, ReplacementAbility, ReplacementAst } from "@mtg-forge-ts/core";
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
// TurnFaceUpReplacement
// ---------------------------------------------------------------------------

export class TurnFaceUpReplacement extends ReplacementHandler {
  static override readonly eventKind = "TurnFaceUp";

  override build(ast: ReplacementAst, ctx: ReplacementBuildContext): ReplacementAbility {
    const validCard = getParamRaw(ast, "ValidCard") ?? "Card.Self";
    const layerRaw = getParamRaw(ast, "Layer");
    const preventRaw = getParamRaw(ast, "Prevent");
    const isPrevent = layerRaw === "CantHappen" || preventRaw === "True";
    const { sourceCardId, controllerSeat, replacementId } = ctx;

    return {
      id: replacementId,
      kind: "replacement",
      sourceCardId,
      activeInZones: new Set(["Battlefield" as never]),
      timestamp: 0,
      controllerSeatAtReg: controllerSeat,
      isSelfReplacement: ast.isSelf === true,
      layer: "other",

      matches(intent: MutationIntent): boolean {
        if (intent.kind !== "turnFaceUp") return false;
        const fi = intent as { cardId?: EntityId };

        switch (validCard) {
          case "Card.Self":
            return fi.cardId === sourceCardId;
          case "Card":
            return true;
          default: {
            const lower = validCard.toLowerCase();
            if (lower.startsWith("card.self") || lower.startsWith("permanent.self")) {
              return fi.cardId === sourceCardId;
            }
            return false;
          }
        }
      },

      apply(intent: MutationIntent, _game: unknown): MutationIntent | null {
        if (isPrevent) return null;
        return intent;
      },
    };
  }
}

replacementHandlerRegistry.register(TurnFaceUpReplacement);
