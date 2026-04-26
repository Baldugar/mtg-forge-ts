// SPDX-License-Identifier: GPL-3.0-or-later
// RenownKeywordHandler — processes K:Renown:N keyword lines (Magic
// Origins; CR 702.111) and synthesizes a "deals combat damage to a
// player" TriggeredAbility on the creature.
//
// CR 702.111a — "Renown N": "Whenever this creature deals combat damage
// to a player, if it isn't renowned, put N +1/+1 counters on it and it
// becomes renowned." The keyword line stores N in `params.amount`
// (AMOUNT_KEYWORDS).
//
// MVP scope:
//   1. Add "renown" to card.keywords.
//   2. Stamp `card.renowned = false` if undefined (entry-time
//      bookkeeping). The flag prevents the trigger from re-firing once
//      the creature has been renowned.
//   3. Watch CombatDamageDealt events from this card to a player; on
//      resolve, if !renowned, put N +1/+1 counters and set renowned.
//
// MVP simplification: this handler watches the generic `CombatDamageDealt`
// event family (CR 702.111a is keyed on the combat-damage step). If
// the engine's combat layer doesn't yet emit a player-target variant,
// the trigger fires off the generic event and the resolver checks the
// targetSeat slot to ensure it was a player hit.
import type { EntityId, GameEvent, KeywordAst, ParamValue, TriggeredAbility } from "@mtg-forge-ts/core";
import { CounterType, ZoneType } from "@mtg-forge-ts/core";
import type { Game } from "../../game.js";
import type { StackItemResolver } from "../../stack/stack-item.js";
import { keywordHandlerRegistry } from "../keyword-handler-registry.js";
import type { KeywordActivationContext } from "../keyword-handler.js";
import { KeywordHandler } from "../keyword-handler.js";

type TriggeredAbilityWithResolver = TriggeredAbility & {
  readonly resolver: StackItemResolver | null;
};

export class RenownKeywordHandler extends KeywordHandler {
  static override readonly keyword = "renown" as const;

  override activate(ast: KeywordAst, ctx: KeywordActivationContext): void {
    const card = ctx.game.cards.get(ctx.sourceCardId);
    if (!card) return;

    if (!card.keywords) card.keywords = new Set();
    card.keywords.add("renown");
    if (card.renowned === undefined) card.renowned = false;

    const amountParam = ast.params?.amount as ParamValue | undefined;
    const renownN =
      amountParam && amountParam.kind === "literal" ? Number.parseInt(amountParam.raw as string, 10) : 1;
    const safeN = Number.isFinite(renownN) && renownN > 0 ? renownN : 1;

    const game = ctx.game;
    const sourceCardId = ctx.sourceCardId;
    const controllerSeat = ctx.controllerSeat;
    const triggerId = game.newEntityId();

    const ta: TriggeredAbilityWithResolver = {
      id: triggerId,
      kind: "triggered",
      sourceCardId,
      activeInZones: new Set([ZoneType.Battlefield]),
      timestamp: 0,
      controllerSeatAtReg: controllerSeat,
      isDelayed: false,

      matches(event: GameEvent): boolean {
        // CR 702.111a — combat damage dealt to a player.
        if (event.kind !== "CombatDamageDealt") return false;
        const p = event.payload as { sourceId?: EntityId; targetSeat?: number; targetCardId?: EntityId };
        if (p.sourceId !== sourceCardId) return false;
        // Player target only (skip creature/planeswalker/battle hits).
        if (p.targetSeat === undefined) return false;
        if (p.targetCardId !== undefined) return false;
        // Don't fire if already renowned.
        const c = game.cards.get(sourceCardId);
        if (!c) return false;
        if (c.renowned === true) return false;
        return true;
      },

      resolver: {
        *resolve(gameUnknown: unknown): Generator<unknown, void, unknown> {
          const g = gameUnknown as Game;
          const c = g.cards.get(sourceCardId);
          if (!c) return;
          if (c.renowned === true) return; // re-check at resolution.
          yield* g.action.addCounter(sourceCardId, CounterType.PlusOnePlusOne, safeN, sourceCardId);
          c.renowned = true;
        },
      },
    };

    if (!card.triggeredAbilities) card.triggeredAbilities = [];
    card.triggeredAbilities.push(ta as unknown as TriggeredAbility);
    game.triggerRegistry.register(ta as unknown as TriggeredAbility);
  }

  override deactivate(_ast: KeywordAst, ctx: KeywordActivationContext): void {
    const card = ctx.game.cards.get(ctx.sourceCardId);
    card?.keywords?.delete("renown");
  }
}

keywordHandlerRegistry.register(RenownKeywordHandler);
