// SPDX-License-Identifier: GPL-3.0-or-later
// CreateTokenReplacement — handles Forge's `R:Event$ CreateToken` replacement.
// Intercepts token-creation mutation intents (Wave 48 CreateTokenIntent) and
// modifies the count. Doubling Season (token half), Parallel Lives, Anointed
// Procession, and Mondrak / Glory Dominus all live here.
//
// Forge patterns:
//   R:Event$ CreateToken | ValidPlayer$ You | Amount$ 2
//     | Description$ If you would create one or more tokens, create twice
//                    that many of those tokens instead.
//   R:Event$ CreateToken | ValidPlayer$ Opponent | Layer$ CantHappen
//     | Description$ Opponents can't create tokens.
//
// Wave 48 supports:
//   ValidPlayer$ You / Opponent / Each / Player              — seat filter.
//   Amount$ <int>                                            — count multiplier.
//   AddAmount$ <int>                                         — additive bump.
//   Layer$ CantHappen / Prevent$ True                        — block creation.
import type { MutationIntent, PlayerSeat, ReplacementAbility, ReplacementAst } from "@mtg-forge-ts/core";
import type { Game } from "../../game.js";
import { replacementHandlerRegistry } from "../replacement-handler-registry.js";
import type { ReplacementBuildContext } from "../replacement-handler.js";
import { ReplacementHandler } from "../replacement-handler.js";
import { lookupReplaceWithAbility, runReplaceWithIntentMutation } from "./replace-with-svar.js";

const getParamRaw = (ast: ReplacementAst, key: string): string | undefined => {
  const pv = ast.params[key];
  if (!pv) return undefined;
  if (pv.kind === "literal") return pv.raw;
  return undefined;
};

const parseLiteralInt = (raw: string | undefined): number | null => {
  if (raw === undefined) return null;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : null;
};

// ---------------------------------------------------------------------------
// CreateTokenReplacement
// ---------------------------------------------------------------------------

export class CreateTokenReplacement extends ReplacementHandler {
  static override readonly eventKind = "CreateToken";

  override build(ast: ReplacementAst, ctx: ReplacementBuildContext): ReplacementAbility {
    const { sourceCardId, controllerSeat, replacementId } = ctx;
    const validPlayer = getParamRaw(ast, "ValidPlayer") ?? "You";
    const layerParam = getParamRaw(ast, "Layer");
    const preventParam = getParamRaw(ast, "Prevent");
    const multiplier = parseLiteralInt(getParamRaw(ast, "Amount"));
    const addAmount = parseLiteralInt(getParamRaw(ast, "AddAmount"));
    // Wave 67 — ReplaceWith$ <SVar> for SVar-bodied token doublers (Anointed
    // Procession / Parallel Lives / Doubling Season's token half).
    //   R:Event$ CreateToken | ValidPlayer$ You | ReplaceWith$ DBDouble
    //   SVar:DBDouble:DB$ ReplaceToken | Multiplier$ 2
    const replaceWithKey = getParamRaw(ast, "ReplaceWith") ?? ast.effect.handlerKey;

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
        if (intent.kind !== "createToken") return false;
        const ti = intent as { controllerSeat?: PlayerSeat };
        if (ti.controllerSeat === undefined) return false;
        if (validPlayer === "You") return ti.controllerSeat === controllerSeat;
        if (validPlayer === "Opponent") return ti.controllerSeat !== controllerSeat;
        if (validPlayer === "Each" || validPlayer === "Player") return true;
        return false;
      },

      apply(intent: MutationIntent, gameUnknown: unknown): MutationIntent | null {
        if (layerParam === "CantHappen" || preventParam === "True") return null;
        const ti = intent as { count?: number };
        const current = ti.count ?? 1;

        // Wave 67 — ReplaceWith$ <SVar> dispatch into the ReplaceEffect family.
        // Forge's Anointed Procession / Parallel Lives parse to a ReplaceWith$
        // DBDouble form whose SVar resolves to DB$ ReplaceToken | Multiplier$ 2.
        // When the SVar resolves to a ReplaceEffect-family handler we thread
        // the createToken intent through the side-channel runner; the SVar
        // body owns the full count rewrite (we DON'T also inline-multiply,
        // which would over-count).
        const game = gameUnknown as Game;
        if (replaceWithKey !== undefined) {
          const ability = lookupReplaceWithAbility(game, sourceCardId, replaceWithKey);
          if (ability !== null) {
            const handlerKey = ability.handlerKey;
            if (handlerKey === "ReplaceEffect" || handlerKey === "ReplaceToken") {
              const next = runReplaceWithIntentMutation(game, sourceCardId, controllerSeat, ability, intent);
              return next;
            }
          }
        }

        // Inline path — Doubling Season / Parallel Lives default semantics:
        // Amount$ 2. Only applies when no SVar handler took over above.
        const m = multiplier ?? 2;
        let newCount = current * m;
        if (addAmount !== null && addAmount !== 0) newCount = newCount + addAmount;
        if (newCount === current) return intent;
        return { ...intent, count: newCount };
      },
    };
  }
}

replacementHandlerRegistry.register(CreateTokenReplacement);
