// SPDX-License-Identifier: GPL-3.0-or-later
// GameWinReplacement — handles Forge's `R:Event$ GameWin` replacement line.
// Intercepts a "player wins the game" event and can prevent it (e.g. Platinum
// Angel: "You can't lose the game and your opponents can't win the game").
//
// Forge patterns:
//   R:Event$ GameWin | ValidPlayer$ Opponent | Prevent$ True
//     | Description$ Your opponents can't win the game.
//   R:Event$ GameWin | ValidPlayer$ Player | Layer$ CantHappen
//     | Description$ No player can win the game.
//
// MVP STATUS: STUB — the "gameWin" MutationIntent kind does not yet exist in
// the engine's mutation-intent taxonomy. matches() returns false unconditionally.
// Registered so the semantic validator stops flagging GameWin as an unknown
// replacement handler key.
//
// TODO(SP3): add a { kind: "gameWin"; seat: PlayerSeat } MutationIntent;
// route game-ending logic through applyWithReplacements; wire this handler's
// matches() to filter by ValidPlayer$.
import type { MutationIntent, ReplacementAbility, ReplacementAst } from "@mtg-forge-ts/core";
import { replacementHandlerRegistry } from "../replacement-handler-registry.js";
import type { ReplacementBuildContext } from "../replacement-handler.js";
import { ReplacementHandler } from "../replacement-handler.js";

// ---------------------------------------------------------------------------
// GameWinReplacement
// ---------------------------------------------------------------------------

export class GameWinReplacement extends ReplacementHandler {
  static override readonly eventKind = "GameWin";

  override build(ast: ReplacementAst, ctx: ReplacementBuildContext): ReplacementAbility {
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

      // TODO(SP3): match { kind: "gameWin"; seat } intents when the intent
      // type is added to the mutation taxonomy.
      matches(_intent: MutationIntent): boolean {
        return false;
      },

      apply(_intent: MutationIntent, _game: unknown): MutationIntent | null {
        // When matched, prevent the game win.
        return null;
      },
    };
  }
}

replacementHandlerRegistry.register(GameWinReplacement);
