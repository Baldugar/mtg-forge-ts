// SPDX-License-Identifier: GPL-3.0-or-later
// AbilityCastTrigger — handles Forge's `T:Mode$ AbilityCast` trigger line.
// Fires when an activated ability is put on the stack.
//
// MVP STATUS: matches on the `AbilityActivated` game event (the engine event
// for when an activated ability is activated and put on the stack). Optionally
// filters by ValidCard$ to narrow to abilities of specific sources.
//
// Forge pattern:
//   T:Mode$ AbilityCast | ValidCard$ Card.Self | Execute$ TrigEffect
//   T:Mode$ AbilityCast | ValidCard$ Creature.YouCtrl | Execute$ TrigEffect
//
// AbilityActivated event payload: { stackItemId, sourceCardId, controllerSeat,
//   abilityKind: "activated" | "manaAbility" }
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
// AbilityCastTrigger
// ---------------------------------------------------------------------------

export class AbilityCastTrigger extends TriggerHandler {
  static override readonly mode = "AbilityCast";

  override build(ast: TriggerAst, ctx: TriggerBuildContext): TriggeredAbility {
    const validCard = getParamRaw(ast, "ValidCard") ?? "Card.Self";
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
        if (event.kind !== "AbilityActivated") return false;
        const { sourceCardId: evSourceId, controllerSeat: evCtrl } = event.payload as {
          stackItemId: EntityId;
          sourceCardId: EntityId;
          controllerSeat: PlayerSeat;
          abilityKind: "activated" | "manaAbility";
        };

        if (validCard === "Card.Self") return evSourceId === sourceCardId;
        if (validCard === "Card") return true;

        const lower = validCard.toLowerCase();
        // YouCtrl — abilities from permanents controlled by our controller.
        if (lower.endsWith(".youctrl")) return evCtrl === controllerSeat;
        // OpponentCtrl — abilities from permanents our opponents control.
        if (lower.endsWith(".opponentctrl")) return evCtrl !== controllerSeat;
        if (lower.startsWith("card.self") || lower.startsWith("permanent.self")) {
          return evSourceId === sourceCardId;
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
              `AbilityCastTrigger: Execute$ SVar '${executeKey}' not found on ${sourceCard.paperCard.name ?? "?"}`,
            );
          }
          if (sv.kind !== "ability" || !sv.ability) {
            throw new Error(
              `AbilityCastTrigger: Execute$ '${executeKey}' is not an ability SVar on ${sourceCard.paperCard.name ?? "?"}`,
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

triggerHandlerRegistry.register(AbilityCastTrigger);
