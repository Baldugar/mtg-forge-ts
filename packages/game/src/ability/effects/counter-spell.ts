// SPDX-License-Identifier: GPL-3.0-or-later
// CounterSpellEffect — counters a target spell or ability on the stack
// (CR 701.5). Removes the targeted stack item from the Stack and, for spell
// items (kind "spell" | "copy"), moves the source card to its owner's
// graveyard. Emits StackItemCountered so trigger handlers observe the event.
//
// Forge DSL: SP$ Counter | ValidTgts$ Spell
import { ZoneType, mkEvent } from "@mtg-forge-ts/core";
import type { EngineYield } from "../../action/engine-yield.js";
import type { Game } from "../../game.js";
import { effectRegistry } from "../effect-registry.js";
import { SpellAbilityEffect } from "../spell-ability-effect.js";
import type { SpellAbility } from "../spell-ability.js";

export class CounterSpellEffect extends SpellAbilityEffect {
  static override readonly handlerKey = "Counter";

  override *resolve(sa: SpellAbility, game: Game): Generator<EngineYield, void, unknown> {
    for (const targetId of sa.targets) {
      const item = game.sharedZones.stack.removeById(targetId);
      if (!item) continue; // already gone — spell fizzled or was already countered

      // CR 701.5a — emit StackItemCountered so trigger handlers observe it.
      yield game.emitEvent(
        mkEvent("StackItemCountered", game.turn, game.phase, {
          stackItemId: item.id,
          byEffectId: sa.sourceCardId,
        }),
      );

      // CR 701.5b — move the source card to its owner's graveyard. Only
      // applies to spell items; activated/triggered abilities have no card
      // to move (they're not "put" anywhere per CR 702.5).
      if (item.kind === "spell" || item.kind === "copy") {
        const sourceCard = game.cards.get(item.sourceCardId);
        if (sourceCard) {
          yield* game.action.moveTo(item.sourceCardId, ZoneType.Graveyard, {
            toSeat: sourceCard.ownerSeat,
            cause: "countered",
          });
        }
      }
    }
  }
}

effectRegistry.register(CounterSpellEffect);
