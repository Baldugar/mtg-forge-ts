// SPDX-License-Identifier: GPL-3.0-or-later
// SunburstKeywordHandler — processes K:Sunburst keyword lines (Fifth
// Dawn, CR 702.43) and synthesizes an ETB trigger that puts +1/+1 (for
// creatures) or charge (for non-creatures) counters equal to the number
// of distinct colors of mana spent to cast this card.
//
// CR 702.43a — "Sunburst is a static ability that functions as the
// object with sunburst enters the battlefield. 'Sunburst' means 'This
// object enters the battlefield with a +1/+1 counter on it for each
// color of mana spent to cast it, if it's a creature, or a charge
// counter on it for each color of mana spent to cast it, if it's not.'"
//
// DSL form:
//   K:Sunburst    (no parameters)
//
// MVP scope:
//   1. Adds "sunburst" to card.keywords.
//   2. Synthesizes an ETB trigger that reads `card.manaSpentColors`
//      (populated by CostMana.pay during cast) and stamps either P1P1
//      counters (Creature) or Charge counters (non-Creature) by the
//      set's size.
//   3. Clears `manaSpentColors` after consumption so a subsequent
//      cast/move doesn't double-count.
//
// If `manaSpentColors` is undefined or empty (e.g. a Sunburst card that
// was put onto the battlefield without being cast — Reanimator-style),
// the trigger stamps zero counters and is a no-op. CR 702.43a's "spent
// to cast it" wording explicitly excludes non-cast entries.
import type { EntityId, GameEvent, KeywordAst, TriggeredAbility } from "@mtg-forge-ts/core";
import { CardType, CounterType, ZoneType } from "@mtg-forge-ts/core";
import type { Game } from "../../game.js";
import type { StackItemResolver } from "../../stack/stack-item.js";
import { keywordHandlerRegistry } from "../keyword-handler-registry.js";
import type { KeywordActivationContext } from "../keyword-handler.js";
import { KeywordHandler } from "../keyword-handler.js";

type TriggeredAbilityWithResolver = TriggeredAbility & {
  readonly resolver: StackItemResolver | null;
};

export class SunburstKeywordHandler extends KeywordHandler {
  static override readonly keyword = "sunburst" as const;

  override activate(_ast: KeywordAst, ctx: KeywordActivationContext): void {
    const card = ctx.game.cards.get(ctx.sourceCardId);
    if (!card) return;

    if (!card.keywords) card.keywords = new Set();
    card.keywords.add("sunburst");

    const game = ctx.game;
    const sourceCardId = ctx.sourceCardId;
    const controllerSeat = ctx.controllerSeat;

    const etbId = game.newEntityId();
    const etb: TriggeredAbilityWithResolver = {
      id: etbId,
      kind: "triggered",
      sourceCardId,
      activeInZones: new Set([ZoneType.Battlefield]),
      timestamp: 0,
      controllerSeatAtReg: controllerSeat,
      isDelayed: false,
      matches(event: GameEvent): boolean {
        if (event.kind !== "CardChangedZone") return false;
        const p = event.payload as { cardId: EntityId; toZone: ZoneType };
        if (p.cardId !== sourceCardId) return false;
        if (p.toZone !== ZoneType.Battlefield) return false;
        // M6.18 — Forge models Sunburst as a state-derived counter at ETB,
        // not as a queue-then-no-op trigger. Without manaSpentColors there's
        // nothing to count and Forge fires no event; gate the trigger so
        // free-cast / etb-action paths (where mana wasn't tracked) don't
        // surface a spurious AbilityActivated.
        const self = game.cards.get(sourceCardId);
        if (!self) return false;
        const colorCount = self.manaSpentColors?.size ?? 0;
        return colorCount > 0;
      },
      resolver: {
        *resolve(gameUnknown: unknown): Generator<unknown, void, unknown> {
          const g = gameUnknown as Game;
          const self = g.cards.get(sourceCardId);
          if (!self) return;
          const colorCount = self.manaSpentColors?.size ?? 0;
          if (colorCount <= 0) {
            // Clear the slot anyway so future re-entries start clean.
            self.manaSpentColors = undefined;
            return;
          }
          const chars = g.layerEngine.computeCharacteristics(sourceCardId);
          const isCreature = chars.types.has(CardType.Creature);
          const counterType = isCreature ? CounterType.PlusOnePlusOne : CounterType.Charge;
          yield* g.action.addCounter(sourceCardId, counterType, colorCount, sourceCardId);
          // Consume the slot — CR 702.43 ties the count to the cast that
          // brought this object to the battlefield; subsequent flickers
          // (which would be a fresh cast/spawn) will repopulate it.
          self.manaSpentColors = undefined;
        },
      },
    };

    if (!card.triggeredAbilities) card.triggeredAbilities = [];
    card.triggeredAbilities.push(etb as unknown as TriggeredAbility);
    game.triggerRegistry.register(etb as unknown as TriggeredAbility);
  }

  override deactivate(_ast: KeywordAst, ctx: KeywordActivationContext): void {
    const card = ctx.game.cards.get(ctx.sourceCardId);
    card?.keywords?.delete("sunburst");
  }
}

keywordHandlerRegistry.register(SunburstKeywordHandler);
