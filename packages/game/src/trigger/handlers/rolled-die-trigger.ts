// SPDX-License-Identifier: GPL-3.0-or-later
// RolledDieTrigger — Wave 16. Forge `T:Mode$ RolledDie`.
// Fires when a player rolls a real die (Strixhaven d20, etc.). Distinct
// from PlanarDieRolled (Planechase) which has its own trigger mode.
//
// Forge pattern:
//   T:Mode$ RolledDie | ValidPlayer$ You | Execute$ TrigEffect
//     | TriggerDescription$ Whenever you roll a die, ...
//
// Engine event: "RollDie" — payload { playerSeat, sides, result }.
import type {
  AbilityAst,
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

export class RolledDieTrigger extends TriggerHandler {
  static override readonly mode = "RolledDie";

  override build(ast: TriggerAst, ctx: TriggerBuildContext): TriggeredAbility {
    const validPlayerRaw = getParamRaw(ast, "ValidPlayer") ?? "You";
    const sidesRaw = getParamRaw(ast, "Sides"); // optional: e.g. "20"
    const resultRaw = getParamRaw(ast, "Result"); // optional: numeric result filter
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
        if (event.kind !== "RollDie") return false;
        const { playerSeat, sides, result } = event.payload as {
          playerSeat: PlayerSeat;
          sides: number;
          result: number;
        };
        if (validPlayerRaw === "You" && playerSeat !== controllerSeat) return false;
        if (validPlayerRaw === "Opponent" && playerSeat === controllerSeat) return false;
        if (sidesRaw !== undefined && sides !== Number.parseInt(sidesRaw, 10)) return false;
        if (resultRaw !== undefined && result !== Number.parseInt(resultRaw, 10)) return false;
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
              `RolledDieTrigger: Execute$ SVar '${executeKey}' not found on ${sourceCard.paperCard.name ?? "?"}`,
            );
          }
          if (sv.kind !== "ability" || !sv.ability) {
            throw new Error(
              `RolledDieTrigger: Execute$ '${executeKey}' is not an ability SVar on ${sourceCard.paperCard.name ?? "?"}`,
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

triggerHandlerRegistry.register(RolledDieTrigger);
