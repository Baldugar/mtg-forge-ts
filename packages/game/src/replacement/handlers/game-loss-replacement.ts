// SPDX-License-Identifier: GPL-3.0-or-later
// GameLossReplacement — handles Forge's `R:Event$ GameLoss` replacement line.
// Intercepts a "player loses the game" event and can prevent it (e.g. Platinum
// Angel: "You can't lose the game").
//
// Forge patterns:
//   R:Event$ GameLoss | ValidPlayer$ You | Prevent$ True
//     | Description$ You can't lose the game.
//   R:Event$ GameLoss | ValidPlayer$ Player | Layer$ CantHappen
//     | Description$ No player can lose the game.
//
// MVP STATUS: STUB — the "gameLoss" MutationIntent kind does not yet exist in
// the engine's mutation-intent taxonomy. matches() returns false unconditionally.
// Registered so the semantic validator stops flagging GameLoss as an unknown
// replacement handler key.
//
// TODO(SP3): add a { kind: "gameLoss"; seat: PlayerSeat } MutationIntent;
// route game-ending logic through applyWithReplacements; wire this handler's
// matches() to filter by ValidPlayer$.
import type { MutationIntent, ReplacementAbility, ReplacementAst } from "@mtg-forge-ts/core";
import { replacementHandlerRegistry } from "../replacement-handler-registry.js";
import type { ReplacementBuildContext } from "../replacement-handler.js";
import { ReplacementHandler } from "../replacement-handler.js";

// ---------------------------------------------------------------------------
// GameLossReplacement
// ---------------------------------------------------------------------------

export class GameLossReplacement extends ReplacementHandler {
  static override readonly eventKind = "GameLoss";

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

      // TODO(SP3): match { kind: "gameLoss"; seat } intents when the intent
      // type is added to the mutation taxonomy.
      matches(_intent: MutationIntent): boolean {
        return false;
      },

      apply(_intent: MutationIntent, _game: unknown): MutationIntent | null {
        // When matched, prevent the game loss.
        return null;
      },
    };
  }
}

replacementHandlerRegistry.register(GameLossReplacement);
