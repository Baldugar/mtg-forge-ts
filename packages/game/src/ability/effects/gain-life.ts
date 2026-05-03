// SPDX-License-Identifier: GPL-3.0-or-later
import type { PlayerSeat } from "@mtg-forge-ts/core";
import type { EngineYield } from "../../action/engine-yield.js";
import type { Game } from "../../game.js";
import { effectRegistry } from "../effect-registry.js";
import { evaluateParamNumber, evaluateParamRaw, hasParam } from "../evaluate-param.js";
import { SpellAbilityEffect } from "../spell-ability-effect.js";
import type { SpellAbility } from "../spell-ability.js";

export class GainLifeEffect extends SpellAbilityEffect {
  static override readonly handlerKey = "GainLife";
  override *resolve(sa: SpellAbility, game: Game): Generator<EngineYield, void, unknown> {
    const n = evaluateParamNumber(sa, "LifeAmount", game);
    const recipients = resolveRecipients(sa, game);
    for (const seat of recipients) {
      yield* game.action.changeLife(seat, +n, { cause: "effect" });
    }
  }
}

function resolveRecipients(sa: SpellAbility, game: Game): readonly PlayerSeat[] {
  const definedRaw = hasParam(sa, "Defined") ? evaluateParamRaw(sa, "Defined") : "You";
  const tok = definedRaw.trim();
  if (tok === "You" || tok === "Player.You") return [sa.controllerSeat];
  if (tok === "Opponent" || tok === "Player.Opponent") {
    const n = sa.controllerSeat as unknown as number;
    return [(n === 0 ? 1 : 0) as unknown as PlayerSeat];
  }
  if (tok === "TargetedController") {
    // CR 614 LKI snapshot: at sub-ability creation the parent's targets
    // are inherited via SpellAbility constructor. The targeted creature
    // may already have moved zones (e.g. Swords to Plowshares exiled it
    // before this DBLife runs), but the layerEngine's LKI snapshot still
    // resolves controllerSeat correctly because cards keep their last
    // controller through zone changes within a single turn.
    if (sa.targets.length === 0) return [];
    const seats = new Set<PlayerSeat>();
    for (const id of sa.targets) {
      const card = game.cards.get(id);
      if (card) seats.add(card.controllerSeat);
    }
    return [...seats];
  }
  if (tok === "Targeted" || tok === "TargetedPlayer") {
    // For TargetedPlayer the target itself is a player seat — but our
    // SpellAbility.targets array is EntityId-typed, so we look the id up
    // as a card first; if it's a player ref the runtime stamps it via
    // targetRefs (preferred). Fall through to controller as a safe default.
    if (sa.targetRefs.length > 0) {
      const seats = new Set<PlayerSeat>();
      for (const ref of sa.targetRefs) {
        if (ref.kind === "player") seats.add(ref.seat);
        else {
          const card = game.cards.get(ref.id);
          if (card) seats.add(card.controllerSeat);
        }
      }
      return [...seats];
    }
    return [sa.controllerSeat];
  }
  // Default to controller for unrecognized Defined$ tokens.
  return [sa.controllerSeat];
}

effectRegistry.register(GainLifeEffect);
