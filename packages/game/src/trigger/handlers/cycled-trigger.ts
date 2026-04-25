// SPDX-License-Identifier: GPL-3.0-or-later
// CycledTrigger — handles Forge's `T:Mode$ Cycled` trigger line.
// Fires when a card with this trigger is cycled (its Cycling activated ability
// is activated and put on the stack — the card is discarded as part of cycling).
//
// MVP STATUS: matches on the `CardCycled` game event. Registered so the
// semantic validator no longer flags Cycled as an unknown mode key.
//
// Forge pattern:
//   T:Mode$ Cycled | ValidCard$ Card.Self | Execute$ TrigEffect
//     | TriggerDescription$ When you cycle ~, ...
//
// CardCycled event payload: { cardId, playerSeat }
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
// CycledTrigger
// ---------------------------------------------------------------------------

export class CycledTrigger extends TriggerHandler {
  static override readonly mode = "Cycled";

  override build(ast: TriggerAst, ctx: TriggerBuildContext): TriggeredAbility {
    const validCard = getParamRaw(ast, "ValidCard") ?? "Card.Self";
    const { sourceCardId, controllerSeat, triggerId } = ctx;
    const executeKey = ast.effect.handlerKey;

    const ta: TriggeredAbilityWithResolver = {
      id: triggerId,
      kind: "triggered",
      sourceCardId,
      // Cycling triggers are active in hand (the card is cycled from hand).
      // Also active on battlefield for enchantments that watch others cycle.
      activeInZones: new Set([ZoneType.Hand, ZoneType.Battlefield]),
      timestamp: 0,
      controllerSeatAtReg: controllerSeat,
      isDelayed: false,

      matches(event: GameEvent): boolean {
        if (event.kind !== "CardCycled") return false;
        const { cardId, playerSeat } = event.payload as {
          cardId: EntityId;
          playerSeat: PlayerSeat;
        };

        if (validCard === "Card.Self") return cardId === sourceCardId;
        if (validCard === "Card") return true;

        const lower = validCard.toLowerCase();
        if (lower.endsWith(".youctrl") || lower === "card.you") {
          return playerSeat === controllerSeat;
        }
        if (lower.endsWith(".opponentctrl")) return playerSeat !== controllerSeat;
        if (lower.startsWith("card.self") || lower.startsWith("permanent.self")) {
          return cardId === sourceCardId;
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
              `CycledTrigger: Execute$ SVar '${executeKey}' not found on ${sourceCard.paperCard.name ?? "?"}`,
            );
          }
          if (sv.kind !== "ability" || !sv.ability) {
            throw new Error(
              `CycledTrigger: Execute$ '${executeKey}' is not an ability SVar on ${sourceCard.paperCard.name ?? "?"}`,
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

triggerHandlerRegistry.register(CycledTrigger);
