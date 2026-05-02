// SPDX-License-Identifier: GPL-3.0-or-later
// AscendKeywordHandler — processes K:Ascend keyword lines (Rivals of
// Ixalan, CR 702.131) and synthesizes a battlefield-zone TriggeredAbility
// that watches `CardChangedZone` events on permanents and grants the
// city's blessing once the controller controls 10+ permanents.
//
// CR 702.131a — "Ascend" — "If you control ten or more permanents, you
// get the city's blessing for the rest of the game."
//
// MVP scope:
//   1. Adds "ascend" to card.keywords.
//   2. Stamps `card.ascend = true`.
//   3. Synthesizes one TriggeredAbility watching CardChangedZone events;
//      the matcher checks the count of battlefield permanents the
//      controller controls and, if ≥ 10, stamps cityBlessing on game.flags.
import type { GameEvent, KeywordAst, TriggeredAbility } from "@mtg-forge-ts/core";
import { ZoneType } from "@mtg-forge-ts/core";
import type { Game } from "../../game.js";
import type { StackItemResolver } from "../../stack/stack-item.js";
import { keywordHandlerRegistry } from "../keyword-handler-registry.js";
import type { KeywordActivationContext } from "../keyword-handler.js";
import { KeywordHandler } from "../keyword-handler.js";

type TriggeredAbilityWithResolver = TriggeredAbility & {
  readonly resolver: StackItemResolver | null;
};

export class AscendKeywordHandler extends KeywordHandler {
  static override readonly keyword = "ascend" as const;

  override activate(_ast: KeywordAst, ctx: KeywordActivationContext): void {
    const card = ctx.game.cards.get(ctx.sourceCardId);
    if (!card) return;
    if (!card.keywords) card.keywords = new Set();
    card.keywords.add("ascend");
    card.ascend = true;

    const game = ctx.game;
    const sourceCardId = ctx.sourceCardId;
    const controllerSeat = ctx.controllerSeat;
    const triggerId = game.newEntityId();

    const ta: TriggeredAbilityWithResolver = {
      id: triggerId,
      kind: "triggered",
      sourceCardId,
      activeInZones: new Set([ZoneType.Battlefield, ZoneType.Stack]),
      timestamp: 0,
      controllerSeatAtReg: controllerSeat,
      isDelayed: false,
      matches(event: GameEvent): boolean {
        // M6.18 — Forge models Ascend as a state-based check, not a queue-
        // every-zone-move trigger. Mirror that by gating the trigger's match
        // on (1) cityBlessing not yet gained AND (2) controller actually has
        // 10+ permanents at the moment the event fires. Otherwise the
        // trigger fires on every ETB / mill / discard and no-ops, producing
        // spurious AbilityActivated + StackItemResolved events for cards
        // like Storm Fleet Sprinter that just ETB into a single-permanent
        // battlefield.
        if (event.kind !== "CardChangedZone") return false;
        if (game.flags.cityBlessing.has(controllerSeat)) return false;
        let count = 0;
        for (const c of game.cards.values()) {
          if (c.zone !== ZoneType.Battlefield) continue;
          if (c.controllerSeat !== controllerSeat) continue;
          count++;
          if (count >= 10) return true;
        }
        return false;
      },
      resolver: {
        // biome-ignore lint/correctness/useYield: cityBlessing stamp is synchronous
        *resolve(gameUnknown: unknown): Generator<unknown, void, unknown> {
          const g = gameUnknown as Game;
          if (g.flags.cityBlessing.has(controllerSeat)) return;
          let count = 0;
          for (const c of g.cards.values()) {
            if (c.zone !== ZoneType.Battlefield) continue;
            if (c.controllerSeat !== controllerSeat) continue;
            count++;
            if (count >= 10) break;
          }
          if (count >= 10) g.flags.cityBlessing.add(controllerSeat);
        },
      },
    };

    if (!card.triggeredAbilities) card.triggeredAbilities = [];
    card.triggeredAbilities.push(ta as unknown as TriggeredAbility);
    game.triggerRegistry.register(ta as unknown as TriggeredAbility);
  }

  override deactivate(_ast: KeywordAst, ctx: KeywordActivationContext): void {
    const card = ctx.game.cards.get(ctx.sourceCardId);
    if (!card) return;
    card.keywords?.delete("ascend");
    card.ascend = undefined;
  }
}

keywordHandlerRegistry.register(AscendKeywordHandler);
