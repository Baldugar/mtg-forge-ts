// SPDX-License-Identifier: GPL-3.0-or-later
// PayLifeReplacement — handles Forge's `R:Event$ PayLife` replacement line.
// Intercepts a "player would pay life" intent. The canonical use is the
// Worship/Phyrexian-Unlife family that prevents life payment entirely.
//
// Forge patterns:
//   R:Event$ PayLife | ValidPlayer$ You | Layer$ CantHappen
//     | Description$ You can't pay life.
//   R:Event$ PayLife | ValidPlayer$ You | Prevent$ True
//     | Description$ If you would pay life, pay nothing instead.
//   R:Event$ PayLife | ValidPlayer$ You | ReplaceWith$ DBLoseEnergy
//     | Description$ If you would pay life, lose that much energy instead.
//
// Wave 17 MVP support mirrors GameLossReplacement: ValidPlayer$ filtering,
// Layer$ CantHappen / Prevent$ True both prevent the payment.
//
// Wave 17b — ReplaceWith$ <SVar> resolves an ability on the source card and
// treats the canonical payment as replaced (returns null). Synchronous
// execution of the substituted ability (lose energy / poison instead of
// life) is plumbed in Wave 18.
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

export class PayLifeReplacement extends ReplacementHandler {
  static override readonly eventKind = "PayLife";

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
        if (intent.kind !== "payLife") return false;
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
          if (ability !== null) {
            // Wave 29 — execute the substituted ability synchronously
            // (lose energy / poison instead of life). Decision-yielding
            // patterns fall through cleanly; the canonical PayLife is
            // still replaced.
            runReplaceWithAbilitySync(game, sourceCardId, controllerSeat, ability);
            return null;
          }
        }
        return intent;
      },
    };
  }
}

replacementHandlerRegistry.register(PayLifeReplacement);
