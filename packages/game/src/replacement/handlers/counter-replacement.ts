// SPDX-License-Identifier: GPL-3.0-or-later
// CounterReplacement — handles Forge's `R:Event$ Counter` replacement line.
// Intercepts counter-spell mutation intents and prevents the counter from
// happening (e.g. "can't be countered" abilities).
//
// Forge pattern:
//   R:Event$ Counter | ValidCard$ Card.Self | Layer$ CantHappen
//   | Description$ This spell can't be countered.
//
// MVP STATUS: STUB — no dedicated "counterSpell" MutationIntent kind exists in
// the current intent taxonomy. matches() returns false until a "counterSpell"
// intent is added to the mutation pipeline and emitted by the stack resolution.
//
// The handler is registered so the semantic validator stops flagging "Counter"
// as an unknown replacement handler key.
//
// TODO(Wave 9): add a { kind: "counterSpell"; cardId } MutationIntent to the
// stack-resolution path; wire matches() to check it; apply() returns null to
// prevent the counter.
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
// CounterReplacement
// ---------------------------------------------------------------------------

export class CounterReplacement extends ReplacementHandler {
  static override readonly eventKind = "Counter";

  override build(ast: ReplacementAst, ctx: ReplacementBuildContext): ReplacementAbility {
    const { sourceCardId, controllerSeat, replacementId } = ctx;
    // ValidCard$ param captured for future implementation — suppress unused-var.
    void getParamRaw(ast, "ValidCard");

    return {
      id: replacementId,
      kind: "replacement",
      sourceCardId,
      activeInZones: new Set(["Battlefield" as never, "Stack" as never]),
      timestamp: 0,
      controllerSeatAtReg: controllerSeat,
      isSelfReplacement: ast.isSelf === true,
      layer: "cantHappen",

      // TODO(Wave 9): match { kind: "counterSpell"; cardId } intents.
      matches(_intent: MutationIntent): boolean {
        return false;
      },

      apply(_intent: MutationIntent, _game: unknown): MutationIntent | null {
        // When matched: return null to prevent the counter.
        // Currently unreachable since matches() always returns false.
        return null;
      },
    };
  }
}

replacementHandlerRegistry.register(CounterReplacement);
