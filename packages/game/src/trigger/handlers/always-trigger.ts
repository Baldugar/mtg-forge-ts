// SPDX-License-Identifier: GPL-3.0-or-later
// AlwaysTrigger — handles Forge's `T:Mode$ Always` trigger line.
// Used internally by Forge for meta-triggers and delayed-trigger setup
// (e.g. "at the beginning of the next upkeep"). The "always fires" semantics
// are driven through a different mechanism than the standard event-matching
// pipeline; the trigger itself is evaluated on a different code path.
//
// MVP STATUS: STUB — matches() returns false unconditionally. Registered so
// the semantic validator stops flagging Always as an unknown mode key.
//
// TODO(SP3): wire up the delayed-trigger machinery so that Always triggers
// evaluate the trigger's condition on every phase transition and fire when
// appropriate (typically used with a condition SVar that gates the effect).
import type { GameEvent, TriggerAst, TriggeredAbility } from "@mtg-forge-ts/core";
import { ZoneType } from "@mtg-forge-ts/core";
import { triggerHandlerRegistry } from "../trigger-handler-registry.js";
import type { TriggerBuildContext } from "../trigger-handler.js";
import { TriggerHandler } from "../trigger-handler.js";

export class AlwaysTrigger extends TriggerHandler {
  static override readonly mode = "Always";

  override build(_ast: TriggerAst, ctx: TriggerBuildContext): TriggeredAbility {
    const { sourceCardId, controllerSeat, triggerId } = ctx;

    return {
      id: triggerId,
      kind: "triggered",
      sourceCardId,
      activeInZones: new Set([ZoneType.Battlefield]),
      timestamp: 0,
      controllerSeatAtReg: controllerSeat,
      isDelayed: false,

      // STUB: Always-mode triggers are evaluated through a different mechanism
      // (condition-based delayed trigger). Return false here to avoid spurious
      // matches on the main event loop.
      matches(_event: GameEvent): boolean {
        return false;
      },
    } as unknown as TriggeredAbility;
  }
}

triggerHandlerRegistry.register(AlwaysTrigger);
