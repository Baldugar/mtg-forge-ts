// SPDX-License-Identifier: GPL-3.0-or-later
// CounterAddedOnceTrigger — handles Forge's `T:Mode$ CounterAddedOnce` trigger
// line. Like CounterAdded but fires only once per scope (Forge tracks a "has
// fired" flag per turn/phase to prevent re-fires in the same step).
//
// MVP STATUS: matches on the `CounterAdded` game event, same as a full
// CounterAdded trigger. The "fires only once" deduplication guard is deferred
// — registered here so the semantic validator no longer flags
// CounterAddedOnce as an unknown mode key.
//
// Forge pattern:
//   T:Mode$ CounterAddedOnce | ValidCard$ Card.Self | Execute$ TrigEffect
//   T:Mode$ CounterAddedOnce | ValidCard$ Card | CounterType$ P1P1
//     | Execute$ TrigEffect | TriggerDescription$ ...
//
// CounterAdded event payload: { cardId, counterType, amount, sourceId? }
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
// CounterAddedOnceTrigger
// ---------------------------------------------------------------------------

export class CounterAddedOnceTrigger extends TriggerHandler {
  static override readonly mode = "CounterAddedOnce";

  override build(ast: TriggerAst, ctx: TriggerBuildContext): TriggeredAbility {
    const validCard = getParamRaw(ast, "ValidCard") ?? "Card.Self";
    const counterType = getParamRaw(ast, "CounterType"); // optional filter
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

      // NOTE(stub): "fires once" deduplication omitted — deferred to Wave N+1.
      // Matches CounterAdded identically to a full CounterAdded trigger for now.
      matches(event: GameEvent): boolean {
        if (event.kind !== "CounterAdded") return false;
        const { cardId, counterType: evCounterType } = event.payload as {
          cardId: EntityId;
          counterType: string;
          amount: number;
        };

        // Optional counter type filter.
        if (counterType !== undefined && evCounterType !== counterType) return false;

        if (validCard === "Card.Self") return cardId === sourceCardId;
        if (validCard === "Card") return true;

        // Dotted qualifiers (e.g. Card.YouCtrl) — fallback to Self match.
        const lower = validCard.toLowerCase();
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
              `CounterAddedOnceTrigger: Execute$ SVar '${executeKey}' not found on ${sourceCard.paperCard.name ?? "?"}`,
            );
          }
          if (sv.kind !== "ability" || !sv.ability) {
            throw new Error(
              `CounterAddedOnceTrigger: Execute$ '${executeKey}' is not an ability SVar on ${sourceCard.paperCard.name ?? "?"}`,
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

triggerHandlerRegistry.register(CounterAddedOnceTrigger);
