// SPDX-License-Identifier: GPL-3.0-or-later
// CounterPlayerAddedAllTrigger — Wave 16. Forge `T:Mode$ CounterPlayerAddedAll`.
// Fires when counters are added to a player (poison, energy, experience…).
//
// Forge pattern:
//   T:Mode$ CounterPlayerAddedAll | ValidPlayer$ You | CounterType$ POISON
//     | Execute$ TrigEffect
//     | TriggerDescription$ Whenever you get one or more poison counters, ...
//
// Engine event: "PlayerCounterAdded" (Wave 16). Engine-side EMIT lands when
// the player counter mutator grows the emit hook (currently TODO).
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

export class CounterPlayerAddedAllTrigger extends TriggerHandler {
  static override readonly mode = "CounterPlayerAddedAll";

  override build(ast: TriggerAst, ctx: TriggerBuildContext): TriggeredAbility {
    const validPlayerRaw = getParamRaw(ast, "ValidPlayer") ?? "You";
    const counterTypeRaw = getParamRaw(ast, "CounterType");
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
        if (event.kind !== "PlayerCounterAdded") return false;
        const { playerSeat, counterType, amount } = event.payload as {
          playerSeat: PlayerSeat;
          counterType: string;
          amount: number;
        };
        if (amount <= 0) return false;
        if (validPlayerRaw === "You" && playerSeat !== controllerSeat) return false;
        if (validPlayerRaw === "Opponent" && playerSeat === controllerSeat) return false;
        if (counterTypeRaw !== undefined && counterTypeRaw !== counterType) return false;
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
              `CounterPlayerAddedAllTrigger: Execute$ SVar '${executeKey}' not found on ${sourceCard.paperCard.name ?? "?"}`,
            );
          }
          if (sv.kind !== "ability" || !sv.ability) {
            throw new Error(
              `CounterPlayerAddedAllTrigger: Execute$ '${executeKey}' is not an ability SVar on ${sourceCard.paperCard.name ?? "?"}`,
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

triggerHandlerRegistry.register(CounterPlayerAddedAllTrigger);
