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
// Wave 84 — `ExtraTurnDelayedTrigger$` + `ExtraTurnDelayedTriggerExecute$`
// (or the corpus-typo `ExtraTurnDelayedTriggerExcute$`) register a one-shot
// delayed trigger that fires once the granted extra turn actually begins
// (Alchemist's Gambit's "you lose the game at end step" payload, Final
// Fortune's "skip your next turn" finale). At registration time we capture
// the recipient seat + the SVar name, then push a delayed trigger whose
// predicate fires on the FIRST `TurnStarted` event for `recipient` AFTER
// `game.flags.pendingExtraTurns` no longer carries that seat (i.e. the
// scheduled extra turn has been popped into the queue and is now active).
// On match the named SVar is resolved as a sub-ability inline, mirroring
// DelayedTriggerEffect's `tearDown` shape. Falls through to a no-op on
// missing SVar so back-compat is preserved.
import { ZoneType, mkPlayerSeat } from "@mtg-forge-ts/core";
import type { AbilityAst, EntityId, PlayerSeat, SVarAst } from "@mtg-forge-ts/core";
import type { EngineYield } from "../../action/engine-yield.js";
import type { Game } from "../../game.js";
import { effectRegistry } from "../effect-registry.js";
import { evaluateParamNumber, evaluateParamRaw, hasParam } from "../evaluate-param.js";
import { SpellAbilityEffect } from "../spell-ability-effect.js";
import { SpellAbility } from "../spell-ability.js";

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

    // Wave 84 — register the optional ExtraTurnDelayedTrigger if the SA
    // params name a sub-SVar to fire during the granted turn. Forge corpus
    // sometimes spells the second param as `ExtraTurnDelayedTriggerExcute`
    // (typo carried since the original card script). Honour both spellings.
    const trigSvarName = hasParam(sa, "ExtraTurnDelayedTrigger")
      ? evaluateParamRaw(sa, "ExtraTurnDelayedTrigger").trim()
      : "";
    const execSvarName = hasParam(sa, "ExtraTurnDelayedTriggerExecute")
      ? evaluateParamRaw(sa, "ExtraTurnDelayedTriggerExecute").trim()
      : hasParam(sa, "ExtraTurnDelayedTriggerExcute")
        ? evaluateParamRaw(sa, "ExtraTurnDelayedTriggerExcute").trim()
        : trigSvarName;
    if (!execSvarName) return;

    const sourceCardId = sa.sourceCardId;
    const ownerSeat = sa.controllerSeat;
    const svars = sa.svars;
    const createdAtTurn = game.turn;
    const targetRecipient: PlayerSeat = recipient;

    const tearDown = (): void => {
      const sv: SVarAst | undefined = svars.get(execSvarName);
      if (!sv || sv.kind !== "ability" || !sv.ability) return;
      const fakeAst: AbilityAst = {
        kind: "spell",
        effect: sv.ability,
        cost: { raw: "" },
      };
      const subSa = new SpellAbility(fakeAst, sourceCardId, ownerSeat, svars, [] as EntityId[]);
      const gen = subSa.makeResolver().resolve(game) as Generator<unknown, void, unknown>;
      let r = gen.next();
      while (!r.done) r = gen.next();
    };

    // Predicate: a TurnStarted whose `activeSeat` matches the recipient
    // AND the recipient's pending-extra-turn count has dropped (i.e. the
    // scheduled extra turn has been consumed into the active turn). This
    // distinguishes the granted turn from an unrelated normal turn that
    // happens to belong to the recipient before the extra turn fires.
    let initialPending = 0;
    for (const s of game.flags.pendingExtraTurns) if (s === targetRecipient) initialPending += 1;
    const dtId = game.newEntityId();
    game.delayedTriggerQueue.add({
      id: dtId,
      kind: "triggered",
      sourceCardId,
      activeInZones: new Set([ZoneType.Battlefield, ZoneType.Stack, ZoneType.Graveyard, ZoneType.Command]),
      timestamp: 0,
      controllerSeatAtReg: ownerSeat,
      isDelayed: true,
      createdAtTurn,
      creationContext: { recipient: targetRecipient, execSvar: execSvarName },
      oneShot: true,
      matches(event) {
        if (event.kind !== "TurnStarted") return false;
        const p = event.payload as { activeSeat?: PlayerSeat };
        if (p.activeSeat !== targetRecipient) return false;
        // Ensure the matched turn is the granted extra turn (or a later
        // queued one): pendingExtraTurns count for recipient must be
        // strictly less than at registration time.
        let nowPending = 0;
        for (const s of game.flags.pendingExtraTurns) if (s === targetRecipient) nowPending += 1;
        if (nowPending >= initialPending) return false;
        tearDown();
        return true;
      },
    });
  }
}

effectRegistry.register(AddTurnEffect);
