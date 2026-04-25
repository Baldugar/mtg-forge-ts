// SPDX-License-Identifier: GPL-3.0-or-later
// TapsTrigger — handles Forge's `T:Mode$ Taps` (and `T:Mode$ Tap`) trigger.
// Fires when the source card (or any matching card) becomes tapped.
//
// Forge pattern:
//   T:Mode$ Taps | ValidCard$ Card.Self | Execute$ TrigMana
//     | TriggerDescription$ Whenever this creature becomes tapped, add {G}.
//
// Engine event: "CardTapped" (packages/core/src/events/event.ts)
//   payload: { cardId: EntityId; sourceId?: EntityId }
//
// ValidCard$ MVP support:
//   Card.Self    — fires when the source card itself is tapped.
//   Card         — fires when any card is tapped.
//   Card.YouCtrl — deferred (requires game reference to check controller).
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
// TapsTrigger  (registered under both "Taps" and "Tap" — same handler)
// ---------------------------------------------------------------------------

export class TapsTrigger extends TriggerHandler {
  static override readonly mode = "Taps";

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
        if (event.kind !== "CardTapped") return false;
        const payload = event.payload as { cardId: EntityId };

        if (validRaw === "Card.Self") {
          return payload.cardId === sourceCardId;
        }

        // "Card" — fires on any card being tapped.
        if (validRaw === "Card") return true;

        // Card.YouCtrl — deferred (no game reference at match-time in MVP).
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
              `TapsTrigger: Execute$ SVar '${executeKey}' not found on ${sourceCard.paperCard.name ?? "?"}`,
            );
          }
          if (sv.kind !== "ability" || !sv.ability) {
            throw new Error(
              `TapsTrigger: Execute$ '${executeKey}' is not an ability SVar on ${sourceCard.paperCard.name ?? "?"}`,
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

triggerHandlerRegistry.register(TapsTrigger);

// ---------------------------------------------------------------------------
// TapTrigger — Forge also uses the singular "Tap" mode in some card texts.
// Both modes map to the same handler logic (CardTapped event check).
// Implemented as a separate class (not a subclass) to satisfy the TypeScript
// static-side constraint: the base class "mode" literal "Taps" is not
// assignable to "Tap" on a subclass static override.
// ---------------------------------------------------------------------------

export class TapTrigger extends TriggerHandler {
  static override readonly mode = "Tap";

  override build(ast: TriggerAst, ctx: TriggerBuildContext): TriggeredAbility {
    // Delegate to TapsTrigger — identical logic, different registry key.
    return new TapsTrigger().build(ast, ctx);
  }
}

triggerHandlerRegistry.register(TapTrigger);
