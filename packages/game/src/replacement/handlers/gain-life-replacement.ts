// SPDX-License-Identifier: GPL-3.0-or-later
// GainLifeReplacement — handles Forge's `R:Event$ GainLife` replacement line.
// Intercepts lifeChange mutation intents with a positive delta (life gain) and
// optionally prevents or replaces the gain.
//
// Forge patterns:
//   R:Event$ GainLife | ValidPlayer$ You | Prevent$ True
//     | Description$ You can't gain life.
//   R:Event$ GainLife | ValidPlayer$ Opponent | Amount$ 0
//     | Description$ Opponents can't gain life.
//   R:Event$ GainLife | ValidPlayer$ Player | Layer$ CantHappen
//     | Description$ No one can gain life.
//
// Prevent$ True OR Layer$ CantHappen — return null (prevents life gain).
// Amount$ <literal int> — replace delta with the literal value.
//
// ValidPlayer$ filter:
//   You         — matches the controller's seat.
//   Opponent    — matches any seat that is not the controller.
//   Player      — matches any seat.
//   (omitted)   — defaults to Player.
//
// The intent kind is "lifeChange" (INTENT_KINDS.LifeChange from mutation-intent.ts).
// Only intents with delta > 0 are matched (this handles life gain; a separate
// LifeReducedReplacement handles loss).
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
// GainLifeReplacement
// ---------------------------------------------------------------------------

export class GainLifeReplacement extends ReplacementHandler {
  static override readonly eventKind = "GainLife";

  override build(ast: ReplacementAst, ctx: ReplacementBuildContext): ReplacementAbility {
    const validPlayer = getParamRaw(ast, "ValidPlayer") ?? "Player";
    const layerRaw = getParamRaw(ast, "Layer");
    const prevent = getParamRaw(ast, "Prevent") === "True" || layerRaw === "CantHappen";
    const newDelta = parseLiteralInt(getParamRaw(ast, "Amount"));
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
        if (intent.kind !== "lifeChange") return false;
        const li = intent as { seat?: PlayerSeat; delta?: number };

        // Only positive delta = life gain.
        if ((li.delta ?? 0) <= 0) return false;

        switch (validPlayer) {
          case "You":
            return li.seat === controllerSeat;
          case "Opponent":
            return li.seat !== controllerSeat;
          default:
            // "Player" or unknown — any player.
            return true;
        }
      },

      apply(intent: MutationIntent, _game: unknown): MutationIntent | null {
        if (prevent) return null;
        if (newDelta !== null) return { ...intent, delta: newDelta };
        return intent;
      },
    };
  }
}

replacementHandlerRegistry.register(GainLifeReplacement);
