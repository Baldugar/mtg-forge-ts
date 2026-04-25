// SPDX-License-Identifier: GPL-3.0-or-later
// SacrificedTrigger — handles Forge's `T:Mode$ Sacrificed` trigger line.
// Matches the engine's "CardSacrificed" event and fires whenever a card
// matching ValidCard$ is sacrificed.
//
// Forge pattern:
//   T:Mode$ Sacrificed | ValidCard$ Creature.YouCtrl | Execute$ TrigDraw
//   T:Mode$ Sacrificed | ValidCard$ Card.Self | Execute$ TrigEffect
//
// ValidCard$ MVP support:
//   Card.Self       — only fires when the source card itself is sacrificed.
//   Card / Card.YouCtrl / Card.OpponentCtrl — any matching card sacrificed.
//   Creature.YouCtrl — any creature controlled by the trigger's controller.
//
// The CardSacrificed event payload carries {cardId, playerSeat, sourceId?}.
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
// SacrificedTrigger
// ---------------------------------------------------------------------------

export class SacrificedTrigger extends TriggerHandler {
  static override readonly mode = "Sacrificed";

  override build(ast: TriggerAst, ctx: TriggerBuildContext): TriggeredAbility {
    const validRaw = getParamRaw(ast, "ValidCard") ?? "Card.Self";
    const { sourceCardId, controllerSeat, triggerId } = ctx;
    const executeKey = ast.effect.handlerKey;

    const ta: TriggeredAbilityWithResolver = {
      id: triggerId,
      kind: "triggered",
      sourceCardId,
      activeInZones: new Set([ZoneType.Battlefield]),
      timestamp: 0,
      controllerSeatAtReg: controllerSeat,
      isDelayed: false,

      matches(event: GameEvent): boolean {
        if (event.kind !== "CardSacrificed") return false;
        const { cardId, playerSeat } = event.payload as {
          cardId: EntityId;
          playerSeat: PlayerSeat;
        };

        if (validRaw === "Card.Self") return cardId === sourceCardId;
        if (validRaw === "Card") return true;

        // Controller-qualified filters — check the sacrificing player's seat.
        const tokens = validRaw.split(".").map((t) => t.trim().toLowerCase());
        const qualifier = tokens[1] ?? "";
        if (qualifier === "youctrl") return playerSeat === controllerSeat;
        if (qualifier === "opponentctrl") return playerSeat !== controllerSeat;

        // Unknown filter — no match in MVP.
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
              `SacrificedTrigger: Execute$ SVar '${executeKey}' not found on ${sourceCard.paperCard.name ?? "?"}`,
            );
          }
          if (sv.kind !== "ability" || !sv.ability) {
            throw new Error(
              `SacrificedTrigger: Execute$ '${executeKey}' is not an ability SVar on ${sourceCard.paperCard.name ?? "?"}`,
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

triggerHandlerRegistry.register(SacrificedTrigger);
