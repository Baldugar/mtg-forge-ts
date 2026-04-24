// SPDX-License-Identifier: GPL-3.0-or-later
import { ZoneType } from "@mtg-forge-ts/core";
import type { EngineYield } from "../../action/engine-yield.js";
import type { Game } from "../../game.js";
import { effectRegistry } from "../effect-registry.js";
import { SpellAbilityEffect } from "../spell-ability-effect.js";
import type { SpellAbility } from "../spell-ability.js";

export class ReturnToHandEffect extends SpellAbilityEffect {
  static override readonly handlerKey = "ReturnToHand";
  override *resolve(sa: SpellAbility, game: Game): Generator<EngineYield, void, unknown> {
    for (const targetId of sa.targets) {
      const card = game.cards.get(targetId);
      const ownerSeat = card?.ownerSeat;
      yield* game.action.moveTo(
        targetId,
        ZoneType.Hand,
        ownerSeat !== undefined ? { toSeat: ownerSeat, cause: "effect" } : { cause: "effect" },
      );
    }
  }
}

effectRegistry.register(ReturnToHandEffect);
