// SPDX-License-Identifier: GPL-3.0-or-later
// AddCounterReplacement — handles Forge's `R:Event$ AddCounter` replacement.
// Intercepts counter-addition mutation intents and doubles (or otherwise
// modifies) the amount. Used by Doubling Season / Vorinclex-style effects.
//
// Forge pattern:
//   R:Event$ AddCounter | ValidCard$ Permanent.YouCtrl | Amount$ 2
//   | Description$ If one or more counters would be put on a permanent you control,
//   |               twice that many of each kind are put on it instead.
//
// MVP STATUS: STUB — no dedicated "addCounter" MutationIntent kind exists in
// the current intent taxonomy (counter addition goes through game.action.addCounter
// which is a direct call). matches() returns false until a MutationIntent is
// added to the add-counter path.
//
// The handler is registered so the semantic validator stops flagging "AddCounter"
// as an unknown replacement handler key.
//
// TODO(Wave 9): add a { kind: "addCounter"; cardId; counterType; amount }
// MutationIntent to game.action.addCounter; route it through the replacement
// engine; wire this handler's apply() to double `amount`.
import type { MutationIntent, ReplacementAbility, ReplacementAst } from "@mtg-forge-ts/core";
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
// AddCounterReplacement
// ---------------------------------------------------------------------------

export class AddCounterReplacement extends ReplacementHandler {
  static override readonly eventKind = "AddCounter";

  override build(ast: ReplacementAst, ctx: ReplacementBuildContext): ReplacementAbility {
    const { sourceCardId, controllerSeat, replacementId } = ctx;
    const amountStr = getParamRaw(ast, "Amount");
    const multiplier = amountStr !== undefined ? Number.parseInt(amountStr, 10) : 2;

    return {
      id: replacementId,
      kind: "replacement",
      sourceCardId,
      activeInZones: new Set(["Battlefield" as never]),
      timestamp: 0,
      controllerSeatAtReg: controllerSeat,
      isSelfReplacement: ast.isSelf === true,
      layer: "other",

      // TODO(Wave 9): match { kind: "addCounter" } intents.
      matches(_intent: MutationIntent): boolean {
        return false;
      },

      apply(intent: MutationIntent, _game: unknown): MutationIntent | null {
        // When matched: multiply the counter amount.
        const ci = intent as { amount?: number };
        const newAmount = (ci.amount ?? 1) * multiplier;
        return { ...intent, amount: newAmount };
      },
    };
  }
}

replacementHandlerRegistry.register(AddCounterReplacement);
