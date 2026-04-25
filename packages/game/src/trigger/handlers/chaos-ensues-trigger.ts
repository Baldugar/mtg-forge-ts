// SPDX-License-Identifier: GPL-3.0-or-later
// ChaosEnsuesTrigger — handles Forge's `T:Mode$ ChaosEnsues` trigger line.
// Fires when the Planechase chaos die rolls "chaos".
//
// Planechase is a niche format not yet scaffolded in this engine. The
// Planechase die-roll event type does not exist in the current event taxonomy.
//
// MVP STATUS: STUB — matches() returns false unconditionally. Registered so
// the semantic validator stops flagging ChaosEnsues as an unknown mode key.
//
// TODO(Planechase): when PlanarDiceRolled / ChaosRolled event lands in
// packages/core/src/events/event.ts, implement matches() to filter
// on payload.face === "chaos" and optionally payload.planId === sourceCardId.
import type { GameEvent, TriggerAst, TriggeredAbility } from "@mtg-forge-ts/core";
import { ZoneType } from "@mtg-forge-ts/core";
import { triggerHandlerRegistry } from "../trigger-handler-registry.js";
import type { TriggerBuildContext } from "../trigger-handler.js";
import { TriggerHandler } from "../trigger-handler.js";

export class ChaosEnsuesTrigger extends TriggerHandler {
  static override readonly mode = "ChaosEnsues";

  override build(_ast: TriggerAst, ctx: TriggerBuildContext): TriggeredAbility {
    const { sourceCardId, controllerSeat, triggerId } = ctx;

    return {
      id: triggerId,
      kind: "triggered",
      sourceCardId,
      // Planechase planes live in the Command zone in most implementations.
      activeInZones: new Set([ZoneType.Command]),
      timestamp: 0,
      controllerSeatAtReg: controllerSeat,
      isDelayed: false,

      // STUB: no Planechase event in current taxonomy — always returns false.
      matches(_event: GameEvent): boolean {
        return false;
      },
    } as unknown as TriggeredAbility;
  }
}

triggerHandlerRegistry.register(ChaosEnsuesTrigger);
