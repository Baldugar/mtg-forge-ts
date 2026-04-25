// SPDX-License-Identifier: GPL-3.0-or-later
// DamageReplacement — handles Forge's `R:Event$ DamageDone` replacement line.
// Intercepts damage mutation intents and either prevents them entirely or
// replaces the damage amount.
//
// Forge patterns:
//   R:Event$ DamageDone | ValidTarget$ You | Prevent$ True | Description$ Prevent all damage to you.
//   R:Event$ DamageDone | ValidSource$ Card.Self | Amount$ 0 | Description$ This deals no damage.
//   R:Event$ DamageDone | ValidTarget$ You | Amount$ 0 | Description$ Prevent the next 3 damage to you.
//
// Part F Wave 1 support:
//   Prevent$ True           — return null (damage prevented entirely)
//   Amount$ <literal int>   — replace intent.amount with the literal value
//
// ValidTarget$ filter:
//   You         — matches intents targeting the controller's seat (player damage)
//   Opponent    — matches intents targeting the non-controller seat
//   Player      — matches any player damage intent
//   Creature    — matches creature damage intents
//   Any / Card  — matches all damage intents
//
// ValidSource$ filter:
//   Card.Self   — only damage from the source card triggers
//   Card / Any  — any source triggers
//
// ReplaceWith$ DBDouble and similar compound replacements are deferred to
// Part F2 (require full SVar-ability dispatch).
import type {
  EntityId,
  MutationIntent,
  PlayerSeat,
  ReplacementAbility,
  ReplacementAst,
} from "@mtg-forge-ts/core";
import { replacementHandlerRegistry } from "../replacement-handler-registry.js";
import type { ReplacementBuildContext } from "../replacement-handler.js";
import { ReplacementHandler } from "../replacement-handler.js";

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Extract a literal string param from ReplacementAst.params, or return undefined. */
const getParamRaw = (ast: ReplacementAst, key: string): string | undefined => {
  const pv = ast.params[key];
  if (!pv) return undefined;
  if (pv.kind === "literal") return pv.raw;
  return undefined;
};

/** Parse a literal integer string; returns null on failure. */
const parseLiteralInt = (raw: string | undefined): number | null => {
  if (raw === undefined) return null;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : null;
};

// ---------------------------------------------------------------------------
// DamageReplacement
// ---------------------------------------------------------------------------

export class DamageReplacement extends ReplacementHandler {
  static override readonly eventKind = "DamageDone";

  override build(ast: ReplacementAst, ctx: ReplacementBuildContext): ReplacementAbility {
    const validTarget = getParamRaw(ast, "ValidTarget") ?? "Any";
    const validSource = getParamRaw(ast, "ValidSource") ?? "Any";
    const prevent = getParamRaw(ast, "Prevent") === "True";
    const amountRaw = getParamRaw(ast, "Amount");
    const newAmount = parseLiteralInt(amountRaw);
    const replaceWith = ast.effect.handlerKey;
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
        if (intent.kind !== "damage") return false;
        const di = intent as {
          sourceId?: EntityId;
          targetKind?: string;
          targetId?: EntityId | PlayerSeat;
          amount?: number;
        };

        // ValidSource$ filter
        if (validSource === "Card.Self" && di.sourceId !== sourceCardId) return false;
        // "Card" / "Any" / undefined → any source passes

        // ValidTarget$ filter
        switch (validTarget) {
          case "You":
            // Must be a player target matching the controller's seat
            if (di.targetKind !== "player" && di.targetKind !== "planeswalker") return false;
            if (di.targetKind === "player" && di.targetId !== controllerSeat) return false;
            break;
          case "Opponent":
            if (di.targetKind !== "player") return false;
            if (di.targetId === controllerSeat) return false;
            break;
          case "Player":
            if (di.targetKind !== "player") return false;
            break;
          case "Creature":
            if (di.targetKind !== "creature") return false;
            break;
          default:
            // "Any", "Card", or unknown — no filter, all damage intents match
            break;
        }

        return true;
      },

      apply(intent: MutationIntent, _game: unknown): MutationIntent | null {
        // Prevent$ True — cancel damage
        if (prevent) return null;

        // Amount$ <literal> — replace the damage amount
        if (newAmount !== null) {
          return { ...intent, amount: newAmount };
        }

        // ReplaceWith$ DBDouble — double the damage (Part F Wave 1 stub)
        if (replaceWith === "DBDouble") {
          const di = intent as { amount?: number };
          const doubled = (di.amount ?? 0) * 2;
          return { ...intent, amount: doubled };
        }

        // Unknown replacement key — no-op
        return intent;
      },
    };
  }
}

replacementHandlerRegistry.register(DamageReplacement);
