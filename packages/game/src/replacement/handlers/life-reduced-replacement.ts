// SPDX-License-Identifier: GPL-3.0-or-later
// LifeReducedReplacement — handles Forge's `R:Event$ LifeReduced` replacement.
// Intercepts lifeChange mutation intents with a negative delta (life loss) or
// a dedicated lifeReduced intent, optionally preventing or modifying the loss.
//
// Forge patterns:
//   R:Event$ LifeReduced | ValidPlayer$ You | Prevent$ True
//     | Description$ You can't lose life.
//   R:Event$ LifeReduced | ValidPlayer$ Opponent | Layer$ CantHappen
//     | Description$ Opponents can't lose life.
//   R:Event$ LifeReduced | ValidPlayer$ Player | Amount$ 0
//     | Description$ No player loses life this turn.
//
// Prevent$ True OR Layer$ CantHappen — return null (prevents life loss).
// Amount$ <literal int> — replace delta with the literal value.
//
// ValidPlayer$ filter:
//   You         — matches the controller's seat.
//   Opponent    — matches any seat that is not the controller.
//   Player      — matches any seat.
//   (omitted)   — defaults to Player.
//
// The intent kind is "lifeChange" (delta < 0) OR "lifeReduced"
// (INTENT_KINDS.LifeReduced from mutation-intent.ts). Both are checked so
// this handler works whether the engine emits the general lifeChange or the
// dedicated lifeReduced shape.
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
// LifeReducedReplacement
// ---------------------------------------------------------------------------

export class LifeReducedReplacement extends ReplacementHandler {
  static override readonly eventKind = "LifeReduced";

  override build(ast: ReplacementAst, ctx: ReplacementBuildContext): ReplacementAbility {
    const validPlayer = getParamRaw(ast, "ValidPlayer") ?? "Player";
    const layerRaw = getParamRaw(ast, "Layer");
    const prevent = getParamRaw(ast, "Prevent") === "True" || layerRaw === "CantHappen";
    const newAmount = parseLiteralInt(getParamRaw(ast, "Amount"));
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
        // Match either the dedicated "lifeReduced" intent or a "lifeChange"
        // with a negative delta (life loss path).
        const li = intent as { seat?: PlayerSeat; delta?: number; amount?: number };
        if (intent.kind === "lifeReduced") {
          // dedicated shape
        } else if (intent.kind === "lifeChange") {
          if ((li.delta ?? 0) >= 0) return false; // only negative delta = loss
        } else {
          return false;
        }

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
        if (newAmount !== null) {
          // For lifeChange (negative delta), Amount$ 0 means no loss.
          if (intent.kind === "lifeChange") return { ...intent, delta: 0 };
          if (intent.kind === "lifeReduced") return { ...intent, amount: newAmount };
        }
        return intent;
      },
    };
  }
}

replacementHandlerRegistry.register(LifeReducedReplacement);
