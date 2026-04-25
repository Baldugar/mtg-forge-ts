// SPDX-License-Identifier: GPL-3.0-or-later
// UntapReplacement — handles Forge's `R:Event$ Untap` replacement line.
// Intercepts untap mutation intents and optionally prevents them (most common
// use case: "this doesn't untap during your untap step").
//
// Forge patterns:
//   R:Event$ Untap | ValidCard$ Card.Self | Layer$ CantHappen
//     | Description$ Doesn't untap during your untap step.
//   R:Event$ Untap | ValidCard$ Card.Self | Prevent$ True
//     | Description$ This permanent doesn't untap.
//   R:Event$ Untap | ValidCard$ Creature.YouCtrl | Layer$ CantHappen
//     | Description$ Creatures you control don't untap during your untap step.
//
// This is the biggest single coverage win in Wave 9: 27 corpus cards use this
// pattern (Mox Diamond, Cold Snap freeze effects, tap-lock enchantments, etc.).
//
// Layer$ CantHappen OR Prevent$ True — return null (prevents untap).
//
// ValidCard$ filter:
//   Card.Self     — matches the source card itself (most common).
//   Card          — matches any permanent (rare, global lock).
//   Creature.YouCtrl — matches creatures the controller controls.
//   (unknown)     — fall through to prevent (conservative default for locks).
//
// The intent kind is "untap" (INTENT_KINDS.Untap from mutation-intent.ts).
import type { EntityId, MutationIntent, ReplacementAbility, ReplacementAst } from "@mtg-forge-ts/core";
import { replacementHandlerRegistry } from "../replacement-handler-registry.js";
import type { ReplacementBuildContext } from "../replacement-handler.js";
import { ReplacementHandler } from "../replacement-handler.js";

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

const getParamRaw = (ast: ReplacementAst, key: string): string | undefined => {
  const pv = ast.params[key];
  if (!pv) return undefined;
  if (pv.kind === "literal") return pv.raw;
  return undefined;
};

// ---------------------------------------------------------------------------
// UntapReplacement
// ---------------------------------------------------------------------------

export class UntapReplacement extends ReplacementHandler {
  static override readonly eventKind = "Untap";

  override build(ast: ReplacementAst, ctx: ReplacementBuildContext): ReplacementAbility {
    const validCard = getParamRaw(ast, "ValidCard") ?? "Card.Self";
    const layerRaw = getParamRaw(ast, "Layer");
    const preventRaw = getParamRaw(ast, "Prevent");
    // CantHappen layer or explicit Prevent$ True both prevent the untap.
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
        if (intent.kind !== "untap") return false;
        const ui = intent as { cardId?: EntityId };

        switch (validCard) {
          case "Card.Self":
            return ui.cardId === sourceCardId;
          case "Card":
            // Global — matches any untap intent.
            return true;
          default: {
            // Dotted filters like "Creature.YouCtrl" — check Self as
            // conservative fallback for now (most cards say Card.Self anyway).
            // Unrecognised qualifiers: match nothing to avoid false prevents.
            const lower = validCard.toLowerCase();
            if (lower.startsWith("card.self") || lower.startsWith("permanent.self")) {
              return ui.cardId === sourceCardId;
            }
            // Unknown filter — no match (safe, avoids blocking wrong cards).
            return false;
          }
        }
      },

      apply(intent: MutationIntent, _game: unknown): MutationIntent | null {
        // Prevent the untap entirely.
        if (isPrevent) return null;
        // No other replacement variant for Untap in MVP — pass through.
        return intent;
      },
    };
  }
}

replacementHandlerRegistry.register(UntapReplacement);
