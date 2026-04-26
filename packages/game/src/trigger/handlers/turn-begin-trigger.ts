// SPDX-License-Identifier: GPL-3.0-or-later
// TurnBeginTrigger — Wave 16. Forge `T:Mode$ TurnBegin`.
// Fires at the start of a turn (canonical "BeginningOfYourTurn" semantic).
//
// Forge pattern:
//   T:Mode$ TurnBegin | ValidPlayer$ You | Execute$ TrigEffect
//     | TriggerDescription$ At the beginning of your upkeep, ...
//
// We model this as StepStarted with step === Untap. Forge's "TurnBegin" mode
// fires before Upkeep — the Untap step is the canonical "turn started"
// boundary. Distinct from PhaseTrigger (which generally targets Upkeep / End
// step); TurnBegin specifically wants the very first step.
import type {
  AbilityAst,
  GameEvent,
  PhaseStep,
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

export class TurnBeginTrigger extends TriggerHandler {
  static override readonly mode = "TurnBegin";

  override build(ast: TriggerAst, ctx: TriggerBuildContext): TriggeredAbility {
    const validPlayerRaw = getParamRaw(ast, "ValidPlayer") ?? "You";
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
        // We additionally accept TurnStarted as a synonym for tests/engine
        // wiring that emits the higher-level event.
        if (event.kind === "TurnStarted") {
          const { activeSeat } = event.payload as { activeSeat: PlayerSeat };
          if (validPlayerRaw === "You") return activeSeat === controllerSeat;
          if (validPlayerRaw === "Opponent") return activeSeat !== controllerSeat;
          return true;
        }
        if (event.kind !== "StepStarted") return false;
        const { step, activeSeat } = event.payload as {
          step: PhaseStep;
          activeSeat: PlayerSeat;
        };
        if (step !== ("Untap" as PhaseStep)) return false;
        if (validPlayerRaw === "You") return activeSeat === controllerSeat;
        if (validPlayerRaw === "Opponent") return activeSeat !== controllerSeat;
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
              `TurnBeginTrigger: Execute$ SVar '${executeKey}' not found on ${sourceCard.paperCard.name ?? "?"}`,
            );
          }
          if (sv.kind !== "ability" || !sv.ability) {
            throw new Error(
              `TurnBeginTrigger: Execute$ '${executeKey}' is not an ability SVar on ${sourceCard.paperCard.name ?? "?"}`,
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

triggerHandlerRegistry.register(TurnBeginTrigger);
