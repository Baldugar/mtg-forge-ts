// SPDX-License-Identifier: GPL-3.0-or-later
// DrawnTrigger — handles Forge's `T:Mode$ Drawn` trigger line.
// Fires when the source card is drawn by its controller (Miracle, Otherworld
// Atlas, and similar "when you draw this card" effects).
//
// MVP STATUS: matches on the `CardDrawn` game event, filtered to the source
// card or the controller's seat depending on ValidCard$. Registered so the
// semantic validator no longer flags Drawn as an unknown mode key.
//
// Forge pattern:
//   T:Mode$ Drawn | ValidCard$ Card.Self | Execute$ TrigEffect
//     | TriggerDescription$ Whenever you draw ~, ...
//
// CardDrawn event payload: { playerSeat, cardId }
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
// DrawnTrigger
// ---------------------------------------------------------------------------

export class DrawnTrigger extends TriggerHandler {
  static override readonly mode = "Drawn";

  override build(ast: TriggerAst, ctx: TriggerBuildContext): TriggeredAbility {
    const validCard = getParamRaw(ast, "ValidCard") ?? "Card.Self";
    const { sourceCardId, controllerSeat, triggerId } = ctx;
    const executeKey = ast.effect.handlerKey;

    const ta: TriggeredAbilityWithResolver = {
      id: triggerId,
      kind: "triggered",
      sourceCardId,
      // Drawn triggers are typically checked in the library / anywhere
      // (the card checks if it was just drawn). Active in hand or battlefield.
      activeInZones: new Set([ZoneType.Hand, ZoneType.Battlefield, ZoneType.Library]),
      timestamp: 0,
      controllerSeatAtReg: controllerSeat,
      isDelayed: false,

      matches(event: GameEvent): boolean {
        if (event.kind !== "CardDrawn") return false;
        const { cardId, playerSeat } = event.payload as {
          cardId: EntityId;
          playerSeat: PlayerSeat;
        };

        if (validCard === "Card.Self") {
          // Fires when the source card itself is drawn by its controller.
          return cardId === sourceCardId && playerSeat === controllerSeat;
        }
        if (validCard === "Card") return true;

        const lower = validCard.toLowerCase();
        if (lower.endsWith(".youctrl") || lower === "card.you") {
          // Fires when the controller draws any card.
          return playerSeat === controllerSeat;
        }
        if (lower.endsWith(".opponentctrl")) return playerSeat !== controllerSeat;
        if (lower.startsWith("card.self") || lower.startsWith("permanent.self")) {
          return cardId === sourceCardId && playerSeat === controllerSeat;
        }
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
              `DrawnTrigger: Execute$ SVar '${executeKey}' not found on ${sourceCard.paperCard.name ?? "?"}`,
            );
          }
          if (sv.kind !== "ability" || !sv.ability) {
            throw new Error(
              `DrawnTrigger: Execute$ '${executeKey}' is not an ability SVar on ${sourceCard.paperCard.name ?? "?"}`,
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

triggerHandlerRegistry.register(DrawnTrigger);
