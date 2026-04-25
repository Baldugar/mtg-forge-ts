// SPDX-License-Identifier: GPL-3.0-or-later
// TransformedTrigger — handles Forge's `T:Mode$ Transformed` trigger line.
// Fires when a double-faced card transforms.
//
// Forge pattern:
//   T:Mode$ Transformed | ValidCard$ Card.Self | Execute$ TrigTransform
//     | TriggerDescription$ Whenever this creature transforms into ...
//
// Engine event: "Transformed" (packages/core/src/events/event.ts)
//   payload: { cardId: EntityId; toFace: "front" | "back" }
//
// ValidCard$ MVP support:
//   Card.Self    — fires when the source card itself transforms.
//   Card         — fires when any card transforms.
import type {
  AbilityAst,
  EntityId,
  GameEvent,
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
// TransformedTrigger
// ---------------------------------------------------------------------------

export class TransformedTrigger extends TriggerHandler {
  static override readonly mode = "Transformed";

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
        if (event.kind !== "Transformed") return false;
        const payload = event.payload as { cardId: EntityId; toFace: "front" | "back" };

        if (validRaw === "Card.Self") {
          return payload.cardId === sourceCardId;
        }

        // "Card" — fires on any card transforming.
        return true;
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
              `TransformedTrigger: Execute$ SVar '${executeKey}' not found on ${sourceCard.paperCard.name ?? "?"}`,
            );
          }
          if (sv.kind !== "ability" || !sv.ability) {
            throw new Error(
              `TransformedTrigger: Execute$ '${executeKey}' is not an ability SVar on ${sourceCard.paperCard.name ?? "?"}`,
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

triggerHandlerRegistry.register(TransformedTrigger);
