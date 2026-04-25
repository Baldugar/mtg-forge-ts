// SPDX-License-Identifier: GPL-3.0-or-later
// SetInMotionTrigger — handles Forge's `T:Mode$ SetInMotion` trigger line.
// Fires when an Archenemy scheme card is "set in motion" (activated from the
// scheme zone).
//
// Archenemy is a niche format variant not yet scaffolded in this engine.
// The SchemeSetInMotion event type does not exist in the current event taxonomy.
//
// MVP STATUS: STUB — matches() returns false unconditionally. Registered so
// the semantic validator stops flagging SetInMotion as an unknown mode key.
//
// TODO(Archenemy): when a SchemeSetInMotion (or equivalent) event lands in
// packages/core/src/events/event.ts, implement matches() accordingly.
import type { GameEvent, TriggerAst, TriggeredAbility } from "@mtg-forge-ts/core";
import { ZoneType } from "@mtg-forge-ts/core";
import { triggerHandlerRegistry } from "../trigger-handler-registry.js";
import type { TriggerBuildContext } from "../trigger-handler.js";
import { TriggerHandler } from "../trigger-handler.js";

export class SetInMotionTrigger extends TriggerHandler {
  static override readonly mode = "SetInMotion";

  override build(_ast: TriggerAst, ctx: TriggerBuildContext): TriggeredAbility {
    const { sourceCardId, controllerSeat, triggerId } = ctx;

    return {
      id: triggerId,
      kind: "triggered",
      sourceCardId,
      // Scheme cards live in the Command zone in Archenemy format.
      activeInZones: new Set([ZoneType.Command]),
      timestamp: 0,
      controllerSeatAtReg: controllerSeat,
      isDelayed: false,

      // STUB: no Archenemy event in current taxonomy — always returns false.
      matches(_event: GameEvent): boolean {
        return false;
      },
    } as unknown as TriggeredAbility;
  }
}

triggerHandlerRegistry.register(SetInMotionTrigger);
