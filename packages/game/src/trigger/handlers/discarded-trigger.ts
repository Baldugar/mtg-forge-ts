// SPDX-License-Identifier: GPL-3.0-or-later
// DiscardedTrigger — handles Forge's `T:Mode$ Discarded` trigger line.
// Matches the engine's "CardDiscarded" event and fires whenever a card
// matching ValidCard$ is discarded.
//
// Forge pattern:
//   T:Mode$ Discarded | ValidCard$ Card.Self | Execute$ TrigCast
//   T:Mode$ Discarded | ValidCard$ Card | Execute$ TrigEffect
//
// ValidCard$ MVP support:
//   Card.Self           — only fires when the source card itself is discarded.
//   Card                — fires for any discarded card.
//   Card.YouCtrl        — fires when the controller discards a card.
//   Card.OpponentCtrl   — fires when an opponent discards a card.
//
// The CardDiscarded event payload carries {playerSeat, cardId, cause}.
import type {
  AbilityAst,
  EntityId,
  GameEvent,
  PlayerSeat,
  SVarAst,
  TriggerAst,
  TriggeredAbility,
} from "@mtg-forge-ts/core";
import { ZoneType } from "@mtg-forge-ts/core";
import { SpellAbility } from "../../ability/spell-ability.js";
import type { Game } from "../../game.js";
import type { StackItemResolver } from "../../stack/stack-item.js";
import { triggerHandlerRegistry } from "../trigger-handler-registry.js";
import type { TriggerBuildContext } from "../trigger-handler.js";
import { TriggerHandler } from "../trigger-handler.js";

type TriggeredAbilityWithResolver = TriggeredAbility & {
  readonly resolver: StackItemResolver | null;
};

const getParamRaw = (ast: TriggerAst, key: string): string | undefined => {
  const pv = ast.params[key];
  if (!pv) return undefined;
  if (pv.kind === "literal") return pv.raw;
  return undefined;
};

// ---------------------------------------------------------------------------
// DiscardedTrigger
// ---------------------------------------------------------------------------

export class DiscardedTrigger extends TriggerHandler {
  static override readonly mode = "Discarded";

  override build(ast: TriggerAst, ctx: TriggerBuildContext): TriggeredAbility {
    const validRaw = getParamRaw(ast, "ValidCard") ?? "Card.Self";
    const { sourceCardId, controllerSeat, triggerId } = ctx;
    const executeKey = ast.effect.handlerKey;

    const ta: TriggeredAbilityWithResolver = {
      id: triggerId,
      kind: "triggered",
      sourceCardId,
      // Discard triggers on cards in hand are active while in hand or battlefield.
      // MVP: active on battlefield (hand-zone triggers deferred to SP3).
      activeInZones: new Set([ZoneType.Battlefield, ZoneType.Hand]),
      timestamp: 0,
      controllerSeatAtReg: controllerSeat,
      isDelayed: false,

      matches(event: GameEvent): boolean {
        if (event.kind !== "CardDiscarded") return false;
        const { cardId, playerSeat } = event.payload as {
          cardId: EntityId;
          playerSeat: PlayerSeat;
        };

        if (validRaw === "Card.Self") return cardId === sourceCardId;
        if (validRaw === "Card") return true;

        const tokens = validRaw.split(".").map((t) => t.trim().toLowerCase());
        const qualifier = tokens[1] ?? "";
        if (qualifier === "youctrl") return playerSeat === controllerSeat;
        if (qualifier === "opponentctrl") return playerSeat !== controllerSeat;

        return false;
      },

      resolver: {
        *resolve(gameUnknown: unknown): Generator<unknown, void, unknown> {
          const game = gameUnknown as Game;
          const sourceCard = game.cards.get(sourceCardId);
          if (!sourceCard) return;
          const def = sourceCard.paperCard.definition;
          if (!def) return;
          const svars = def.svars as ReadonlyMap<string, SVarAst>;
          const sv = svars.get(executeKey);
          if (!sv) {
            throw new Error(
              `DiscardedTrigger: Execute$ SVar '${executeKey}' not found on ${sourceCard.paperCard.name ?? "?"}`,
            );
          }
          if (sv.kind !== "ability" || !sv.ability) {
            throw new Error(
              `DiscardedTrigger: Execute$ '${executeKey}' is not an ability SVar on ${sourceCard.paperCard.name ?? "?"}`,
            );
          }
          const fakeAst: AbilityAst = {
            kind: "spell",
            effect: sv.ability,
            cost: { raw: "" },
          };
          const sa = new SpellAbility(fakeAst, sourceCardId, controllerSeat, svars, []);
          const innerResolver = sa.makeResolver();
          yield* innerResolver.resolve(game);
        },
      },
    };

    return ta as unknown as TriggeredAbility;
  }
}

triggerHandlerRegistry.register(DiscardedTrigger);
