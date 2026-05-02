// SPDX-License-Identifier: GPL-3.0-or-later
// CounterAddedOnceTrigger — handles Forge's `T:Mode$ CounterAddedOnce` trigger
// line. Like CounterAdded but fires only once per scope.
//
// Wave 12B — once-per-turn fire guard. The Wave 12 directive specifies
// once-per-turn semantics; the trigger matches on the first qualifying
// CounterAdded event each turn and suppresses subsequent matches until
// `game.turn` advances.
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
    // M6.34 — NewCounterAmount filter (Forge `NewCounterAmount$ N`): fires only
    // when the post-add total of the named counter equals N. Mirrors the
    // CounterAddedTrigger filter for the same param name.
    const newCounterAmountRaw = getParamRaw(ast, "NewCounterAmount");
    const newCounterAmount =
      newCounterAmountRaw !== undefined ? Number.parseInt(newCounterAmountRaw, 10) : undefined;
    const { game: ctxGame, sourceCardId, controllerSeat, triggerId } = ctx;
    const executeKey = ast.effect.handlerKey;

    // Wave 12B — once-per-turn guard (closure-private fired-state).
    let lastFiredOnTurn: number | undefined;
    const currentTurn = (): number | undefined => {
      const g = ctxGame as { turn?: unknown } | undefined;
      const t = g?.turn;
      return typeof t === "number" ? t : undefined;
    };

    const ta: TriggeredAbilityWithResolver = {
      id: triggerId,
      kind: "triggered",
      sourceCardId,
      activeInZones: new Set([ZoneType.Battlefield]),
      timestamp: 0,
      controllerSeatAtReg: controllerSeat,
      isDelayed: false,

      matches(event: GameEvent): boolean {
        if (event.kind !== "CounterAdded") return false;
        const { cardId, counterType: evCounterType } = event.payload as {
          cardId: EntityId;
          counterType: string;
          amount: number;
        };

        // Optional counter type filter (case-insensitive — Forge writes
        // LORE/P1P1/etc. while events use lowercase canonical names).
        if (counterType !== undefined && evCounterType.toLowerCase() !== counterType.toLowerCase()) {
          return false;
        }

        // Predicate gate.
        let predicateOk = false;
        if (validCard === "Card.Self") predicateOk = cardId === sourceCardId;
        else if (validCard === "Card") predicateOk = true;
        else {
          // Dotted qualifiers (e.g. Card.YouCtrl) — fallback to Self match.
          const lower = validCard.toLowerCase();
          if (lower.startsWith("card.self") || lower.startsWith("permanent.self")) {
            predicateOk = cardId === sourceCardId;
          }
        }
        if (!predicateOk) return false;

        // M6.34 — NewCounterAmount filter. Fires only when post-add total
        // of the matching counter equals N. Mirrors Forge's
        // TriggerCounterAddedOnce#"newCounterAmount" param.
        const cardsMap = (ctxGame as unknown as { cards?: Map<EntityId, unknown> }).cards;
        if (newCounterAmount !== undefined) {
          const c = cardsMap?.get(sourceCardId) as { counters?: ReadonlyMap<string, number> } | undefined;
          const total = c?.counters?.get(evCounterType) ?? 0;
          if (total !== newCounterAmount) return false;
        }

        // Once-per-turn gate.
        const turn = currentTurn();
        if (turn !== undefined) {
          if (lastFiredOnTurn === turn) return false;
          lastFiredOnTurn = turn;
        }
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
