// SPDX-License-Identifier: GPL-3.0-or-later
// ChangeZone — generic zone-transition effect. Reads Origin$, Destination$,
// Defined$ params. MVP supports battlefield → graveyard/exile/hand.
// Library-manipulation variants deferred to Part D2.
import { ZoneType } from "@mtg-forge-ts/core";
import type { EngineYield } from "../../action/engine-yield.js";
import type { Game } from "../../game.js";
import { effectRegistry } from "../effect-registry.js";
import { evaluateParamRaw, hasParam } from "../evaluate-param.js";
import { SpellAbilityEffect } from "../spell-ability-effect.js";
import type { SpellAbility } from "../spell-ability.js";

const ZONE_MAP: Readonly<Record<string, ZoneType>> = {
  Battlefield: ZoneType.Battlefield,
  Graveyard: ZoneType.Graveyard,
  Exile: ZoneType.Exile,
  Hand: ZoneType.Hand,
  Library: ZoneType.Library,
};

function parseZone(raw: string): ZoneType | undefined {
  return ZONE_MAP[raw];
}

export class ChangeZoneEffect extends SpellAbilityEffect {
  static override readonly handlerKey = "ChangeZone";
  override *resolve(sa: SpellAbility, game: Game): Generator<EngineYield, void, unknown> {
    const destRaw = hasParam(sa, "Destination$") ? evaluateParamRaw(sa, "Destination$") : undefined;
    const destZone = destRaw !== undefined ? parseZone(destRaw) : undefined;
    if (destZone === undefined) {
      // Cannot proceed without a parseable destination — no-op for safety.
      return;
    }

    for (const targetId of sa.targets) {
      const card = game.cards.get(targetId);
      // For hand moves, route to the card's owner seat.
      if (destZone === ZoneType.Hand && card?.ownerSeat !== undefined) {
        yield* game.action.moveTo(targetId, destZone, { toSeat: card.ownerSeat, cause: "effect" });
      } else {
        yield* game.action.moveTo(targetId, destZone, { cause: "effect" });
      }
    }
  }
}

effectRegistry.register(ChangeZoneEffect);
