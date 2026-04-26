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
import { replacementHandlerRegistry } from "../replacement-handler-registry.js";
import type { ReplacementBuildContext } from "../replacement-handler.js";
import { ReplacementHandler } from "../replacement-handler.js";

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

      apply(intent: MutationIntent, _game: unknown): MutationIntent | null {
        if (layerParam === "CantHappen" || preventParam === "True") return null;
        const ti = intent as { count?: number };
        const current = ti.count ?? 1;
        // Doubling Season / Parallel Lives default semantics: Amount$ 2.
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
