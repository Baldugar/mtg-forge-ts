// SPDX-License-Identifier: GPL-3.0-or-later
// GameLossReplacement — handles Forge's `R:Event$ GameLoss` replacement line.
// Intercepts a "player loses the game" mutation intent and can prevent it
// (Platinum Angel: "You can't lose the game"; Phyrexian Unlife transitions).
//
// Forge patterns:
//   R:Event$ GameLoss | ActiveZones$ Battlefield | ValidPlayer$ You | Layer$ CantHappen
//     | Description$ You can't lose the game and your opponents can't win the game.
//   R:Event$ GameLoss | ActiveZones$ Battlefield | ValidPlayer$ You | ReplaceWith$ ExileSetLife
//     | Description$ If you would lose the game, instead exile this and reset life.
//
// MVP support:
//   ValidPlayer$ You      — match when the losing seat equals controllerSeat.
//   ValidPlayer$ Opponent — match when the losing seat differs from controllerSeat.
//   ValidPlayer$ Each / Player — match any seat.
//   Layer$ CantHappen     — apply() returns null (loss prevented).
//   Prevent$ True         — apply() returns null (loss prevented).
//   ReplaceWith$ <SVar>   — MVP returns the original intent unchanged
//                            (deferred SVar dispatch); the canonical loss
//                            still proceeds. SP4 wires SVar-driven exile
//                            redirect for Exquisite Archangel / Soul Snare.
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

export class GameLossReplacement extends ReplacementHandler {
  static override readonly eventKind = "GameLoss";

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
      // Layer$ CantHappen → cantHappen layer (highest priority replacement
      // class — runs before redirect/modify replacements).
      layer: layerParam === "CantHappen" ? "cantHappen" : "other",

      matches(intent: MutationIntent): boolean {
        if (intent.kind !== "gameLoss") return false;
        const losingSeat = (intent as { seat?: PlayerSeat }).seat;
        if (losingSeat === undefined) return false;
        if (validPlayerRaw === "You") return losingSeat === controllerSeat;
        if (validPlayerRaw === "Opponent") return losingSeat !== controllerSeat;
        if (validPlayerRaw === "Each" || validPlayerRaw === "Player") return true;
        return false;
      },

      apply(intent: MutationIntent, _game: unknown): MutationIntent | null {
        // Layer$ CantHappen or Prevent$ True → prevent loss entirely.
        if (layerParam === "CantHappen" || preventParam === "True") return null;
        // ReplaceWith$ <SVar> redirects deferred to SP4 (Exquisite Archangel
        // exile-and-reset-life flow); return the original intent for now so
        // the canonical loss proceeds.
        return intent;
      },
    };
  }
}

replacementHandlerRegistry.register(GameLossReplacement);
