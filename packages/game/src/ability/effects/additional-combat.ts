// SPDX-License-Identifier: GPL-3.0-or-later
// Wave 60.D — AdditionalCombatEffect. Forge `AB$/SP$/DB$ AdditionalCombat`
// (Aggravated Assault / Relentless Assault / Hellkite Charger / Combat
// Celebrant / Savage Beating / Seize the Day). Schedules an extra combat
// phase + main phase for the targeted/defined player by bumping
// game.flags.pendingAdditionalCombatPhases. The phase handler drains the
// counter at end-of-combat and injects the extra block via
// PhaseSequence.injectExtraCombat.
//
// Forge DSL examples:
//   A:AB$ AdditionalCombat | Cost$ 5 ... ... (Aggravated Assault)
//   A:SP$ AdditionalCombat | ... ...        (Relentless Assault — sorcery)
//   AB$ AdditionalCombat | Defined$ You     (Hellkite Charger)
//
// Supported params:
//   Defined$ You / Player.You → recipient is the controller (default).
//   Defined$ Targeted         → recipient is the (single) target.
//   Defined$ Player.Opponent  → recipient is the (assumed-2P) opposing seat.
//   ValidTgts$ Player         → recipient is the targeted player seat.
//
// MVP: schedules ONE extra combat per resolution. Forge supports a few
// effects that schedule multiple at once via SVar arithmetic — those
// fall through to the same counter; resolving N times bumps N.
import { mkPlayerSeat } from "@mtg-forge-ts/core";
import type { PlayerSeat } from "@mtg-forge-ts/core";
import type { EngineYield } from "../../action/engine-yield.js";
import type { Game } from "../../game.js";
import { effectRegistry } from "../effect-registry.js";
import { evaluateParamRaw, hasParam } from "../evaluate-param.js";
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

export class AdditionalCombatEffect extends SpellAbilityEffect {
  static override readonly handlerKey = "AdditionalCombat";

  // biome-ignore lint/correctness/useYield: pure scheduling — no yields
  override *resolve(sa: SpellAbility, game: Game): Generator<EngineYield, void, unknown> {
    // Determine recipient: targets first (ValidTgts$ Player), then Defined$,
    // else controller.
    let recipient: PlayerSeat;
    if (sa.targets.length > 0) {
      // ValidTgts$ Player puts the seat into sa.targets as a numeric
      // entity-id-shaped slot (mirrors AddTurnEffect).
      const t0 = sa.targets[0];
      recipient = t0 as unknown as PlayerSeat;
    } else if (hasParam(sa, "Defined")) {
      recipient = resolveDefinedPlayer(evaluateParamRaw(sa, "Defined"), sa);
    } else {
      recipient = sa.controllerSeat;
    }

    const cur = game.flags.pendingAdditionalCombatPhases.get(recipient) ?? 0;
    game.flags.pendingAdditionalCombatPhases.set(recipient, cur + 1);
  }
}

effectRegistry.register(AdditionalCombatEffect);
