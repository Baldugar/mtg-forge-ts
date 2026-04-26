// SPDX-License-Identifier: GPL-3.0-or-later
// AddTurnEffect — Forge `SP$ AddTurn` family (Time Walk, Beacon of Tomorrows,
// Alchemist's Gambit, Temporal Manipulation). Schedules an extra turn for the
// targeted/defined player by pushing onto game.flags.pendingExtraTurns.
// PhaseHandler drains the queue at end-of-turn and pushes Turns with
// isExtra=true onto the front of its TurnQueue (CR 500.7).
//
// Forge DSL examples:
//   A:SP$ AddTurn | NumTurns$ 1 | SubAbility$ DBExile
//   A:SP$ AddTurn | ValidTgts$ Player | NumTurns$ 1 | SubAbility$ DBShuffle
//
// Supported params:
//   NumTurns$        — literal/SVar count of extra turns (defaults to 1).
//   ValidTgts$ Player → recipient is the (single) target.
//   Defined$ You / Player.You → recipient is the controller.
//   Other Defined$ values fall through to the controller seat.
//
// TODO(advanced): ExtraTurnDelayedTrigger$ + ExtraTurnDelayedTriggerExcute$
// register a one-shot delayed trigger that fires during the granted turn
// (Alchemist's Gambit's "you lose the game at end step" payload). Wave 15
// MVP only schedules the turn; the delayed-trigger sub-handler is a Wave 16
// follow-up.
import { mkPlayerSeat } from "@mtg-forge-ts/core";
import type { PlayerSeat } from "@mtg-forge-ts/core";
import type { EngineYield } from "../../action/engine-yield.js";
import type { Game } from "../../game.js";
import { effectRegistry } from "../effect-registry.js";
import { evaluateParamNumber, evaluateParamRaw, hasParam } from "../evaluate-param.js";
import { SpellAbilityEffect } from "../spell-ability-effect.js";
import type { SpellAbility } from "../spell-ability.js";

const resolveDefinedPlayer = (raw: string, sa: SpellAbility): PlayerSeat => {
  const trimmed = raw.trim();
  if (trimmed === "Player.Opponent" || trimmed === "Opponent") {
    const n = sa.controllerSeat as unknown as number;
    return mkPlayerSeat(n === 0 ? 1 : 0);
  }
  // You / Player.You / Defined$ Targeted (fallback) → controller
  return sa.controllerSeat;
};

export class AddTurnEffect extends SpellAbilityEffect {
  static override readonly handlerKey = "AddTurn";

  // biome-ignore lint/correctness/useYield: pure scheduling — no yields
  override *resolve(sa: SpellAbility, game: Game): Generator<EngineYield, void, unknown> {
    const num = hasParam(sa, "NumTurns") ? evaluateParamNumber(sa, "NumTurns", game) : 1;

    // Determine recipient: targets first (ValidTgts$ Player), then Defined$,
    // else controller.
    let recipient: PlayerSeat;
    if (sa.targets.length > 0) {
      // ValidTgts$ Player puts the player seat into sa.targets as a numeric
      // entity-id-shaped slot. Forge's targeting layer maps player targets
      // to their seat; SP3 currently stores PlayerSeat there too via cast.
      const t0 = sa.targets[0];
      recipient = t0 as unknown as PlayerSeat;
    } else if (hasParam(sa, "Defined")) {
      recipient = resolveDefinedPlayer(evaluateParamRaw(sa, "Defined"), sa);
    } else {
      recipient = sa.controllerSeat;
    }

    for (let i = 0; i < num; i++) {
      game.flags.pendingExtraTurns.push(recipient);
    }
  }
}

effectRegistry.register(AddTurnEffect);
