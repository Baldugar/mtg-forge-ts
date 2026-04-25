// SPDX-License-Identifier: GPL-3.0-or-later
// LifeGainedTrigger — handles Forge's `T:Mode$ LifeGained` trigger line.
// Matches the engine's "LifeChanged" event where delta > 0 (life gained).
//
// Forge pattern:
//   T:Mode$ LifeGained | ValidPlayer$ You | Execute$ TrigPump
//   T:Mode$ LifeGained | ValidPlayer$ Opponent | Execute$ TrigDraw
//   T:Mode$ LifeGained | ValidPlayer$ Player | Execute$ TrigEffect
//
// ValidPlayer$ MVP support:
//   You         — fires when the controller gains life.
//   Opponent    — fires when any opponent gains life.
//   Player      — fires when any player gains life.
//   (omitted)   — defaults to Player.
//
// The LifeChanged event payload carries {playerSeat, oldLife, newLife, delta, cause}.
// Only events with delta > 0 (life gain) are matched.
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

// ---------------------------------------------------------------------------
// LifeGainedTrigger
// ---------------------------------------------------------------------------

export class LifeGainedTrigger extends TriggerHandler {
  static override readonly mode = "LifeGained";

  override build(ast: TriggerAst, ctx: TriggerBuildContext): TriggeredAbility {
    const validPlayer = getParamRaw(ast, "ValidPlayer") ?? "Player";
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
        if (event.kind !== "LifeChanged") return false;
        const { playerSeat, delta } = event.payload as {
          playerSeat: PlayerSeat;
          delta: number;
        };

        // Only fire on life gain (positive delta).
        if (delta <= 0) return false;

        if (validPlayer === "You") return playerSeat === controllerSeat;
        if (validPlayer === "Opponent") return playerSeat !== controllerSeat;
        // "Player" or any other value — match any player.
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
              `LifeGainedTrigger: Execute$ SVar '${executeKey}' not found on ${sourceCard.paperCard.name ?? "?"}`,
            );
          }
          if (sv.kind !== "ability" || !sv.ability) {
            throw new Error(
              `LifeGainedTrigger: Execute$ '${executeKey}' is not an ability SVar on ${sourceCard.paperCard.name ?? "?"}`,
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

triggerHandlerRegistry.register(LifeGainedTrigger);
