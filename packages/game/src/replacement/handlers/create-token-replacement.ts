// SPDX-License-Identifier: GPL-3.0-or-later
// CreateTokenReplacement — handles Forge's `R:Event$ CreateToken` replacement.
// Intercepts token-creation mutation intents and modifies the count.
// Typically used by Doubling Season / Anointed Procession style effects.
//
// Forge pattern:
//   R:Event$ CreateToken | ValidPlayer$ You | Amount$ 2
//   | Description$ If you would create one or more tokens, create twice that many instead.
//
// MVP STATUS: STUB — no dedicated "createToken" MutationIntent kind exists in
// the current intent taxonomy (token creation goes through game.action.createToken
// which is a direct action call, not an intent-gated mutation). matches() returns
// false until a MutationIntent is added to the token creation path.
//
// The handler is registered so the semantic validator stops flagging "CreateToken"
// as an unknown replacement handler key.
//
// TODO(Wave 9): add a { kind: "createToken"; count; controller; paperCard }
// MutationIntent to game.action.createToken, route it through the replacement
// engine before executing, and wire this handler's apply() to double `count`.
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

// ---------------------------------------------------------------------------
// CreateTokenReplacement
// ---------------------------------------------------------------------------

export class CreateTokenReplacement extends ReplacementHandler {
  static override readonly eventKind = "CreateToken";

  override build(ast: ReplacementAst, ctx: ReplacementBuildContext): ReplacementAbility {
    const { sourceCardId, controllerSeat, replacementId } = ctx;
    const validPlayer = getParamRaw(ast, "ValidPlayer") ?? "You";
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

      // TODO(Wave 9): match { kind: "createToken"; controller } intents.
      matches(_intent: MutationIntent): boolean {
        return false;
      },

      apply(intent: MutationIntent, _game: unknown): MutationIntent | null {
        // When matched: double (or multiply by Amount$) the token count.
        const ti = intent as { count?: number; controller?: PlayerSeat };
        if (validPlayer === "You" && ti.controller !== undefined && ti.controller !== controllerSeat) {
          return intent;
        }
        const newCount = (ti.count ?? 1) * multiplier;
        return { ...intent, count: newCount };
      },
    };
  }
}

replacementHandlerRegistry.register(CreateTokenReplacement);
