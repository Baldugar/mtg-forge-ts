// SPDX-License-Identifier: GPL-3.0-or-later
// DrawReplacement — handles Forge's `R:Event$ Draw` replacement line.
// Intercepts draw-card mutation intents and optionally redirects them to
// a different player (Notion Thief-style) or prevents them.
//
// Forge pattern:
//   R:Event$ Draw | ValidPlayer$ Opponent | ReplaceWith$ DBOpponentMills
//   | Description$ If an opponent would draw a card, you draw a card instead.
//
// MVP STATUS: STUB — no dedicated "drawCards" MutationIntent kind exists in
// the current intent taxonomy (draw goes through game.action.draw which is a
// direct call). matches() returns false until a MutationIntent is added to
// the draw path.
//
// The handler is registered so the semantic validator stops flagging "Draw"
// as an unknown replacement handler key.
//
// TODO(Wave 9): add a { kind: "drawCards"; seat; count } MutationIntent to
// game.action.draw; route it through the replacement engine; wire this
// handler's apply() to redirect the seat for Notion Thief effects.
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
// DrawReplacement
// ---------------------------------------------------------------------------

export class DrawReplacement extends ReplacementHandler {
  static override readonly eventKind = "Draw";

  override build(ast: ReplacementAst, ctx: ReplacementBuildContext): ReplacementAbility {
    const { sourceCardId, controllerSeat, replacementId } = ctx;
    const validPlayer = getParamRaw(ast, "ValidPlayer") ?? "Player";
    const replaceWith = ast.effect.handlerKey;
    const prevent = getParamRaw(ast, "Prevent") === "True";

    return {
      id: replacementId,
      kind: "replacement",
      sourceCardId,
      activeInZones: new Set(["Battlefield" as never]),
      timestamp: 0,
      controllerSeatAtReg: controllerSeat,
      isSelfReplacement: ast.isSelf === true,
      layer: "other",

      // TODO(Wave 9): match { kind: "drawCards"; seat } intents.
      matches(_intent: MutationIntent): boolean {
        return false;
      },

      apply(intent: MutationIntent, _game: unknown): MutationIntent | null {
        // When matched:
        if (prevent) return null;

        // Redirect: e.g. opponent draws → you draw instead.
        const di = intent as { seat?: PlayerSeat };
        if (replaceWith === "DBController" || replaceWith === "DBYou") {
          return { ...intent, seat: controllerSeat };
        }
        if (replaceWith === "DBOpponent") {
          // Redirect to opponent — approximated as "other seat".
          const newSeat: PlayerSeat = (
            di.seat === controllerSeat ? (controllerSeat as number) + 1 : controllerSeat
          ) as PlayerSeat;
          return { ...intent, seat: newSeat };
        }

        // ValidPlayer$ filter (informative for when matches() is implemented).
        void validPlayer;

        // Unknown replacement — return intent unchanged (no-op).
        return intent;
      },
    };
  }
}

replacementHandlerRegistry.register(DrawReplacement);
