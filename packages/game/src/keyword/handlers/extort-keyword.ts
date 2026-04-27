// SPDX-License-Identifier: GPL-3.0-or-later
// ExtortKeywordHandler — processes K:Extort keyword lines (Gatecrash,
// CR 702.99) and synthesizes a battlefield-zone TriggeredAbility that
// drains 1 life from each opponent and gives the controller that much
// life.
//
// CR 702.99a — "Extort" — "Whenever you cast a spell, you may pay {W/B}.
// If you do, each opponent loses 1 life and you gain life equal to the
// total life lost this way."
//
// DSL form:
//   K:Extort     → no parameters
//
// MVP scope:
//   1. Adds "extort" to card.keywords.
//   2. Synthesizes one TriggeredAbility watching `SpellCast` whose
//      controllerSeat matches self's controller.
//   3. Resolver yields a confirmAction; on confirm, the cost-payment is
//      a TODO(advanced) — for MVP we proceed with the drain (the spell
//      cast pipeline will add the {W/B} additional cost gate in a
//      follow-up). Each opponent loses 1; controller gains the total.
import type { EntityId, GameEvent, KeywordAst, PlayerSeat, TriggeredAbility } from "@mtg-forge-ts/core";
import { ZoneType } from "@mtg-forge-ts/core";
import type { Game } from "../../game.js";
import type { StackItemResolver } from "../../stack/stack-item.js";
import { keywordHandlerRegistry } from "../keyword-handler-registry.js";
import type { KeywordActivationContext } from "../keyword-handler.js";
import { KeywordHandler } from "../keyword-handler.js";

type TriggeredAbilityWithResolver = TriggeredAbility & {
  readonly resolver: StackItemResolver | null;
};

type SpellCastPayload = {
  readonly stackItemId: EntityId;
  readonly cardId: EntityId;
  readonly controllerSeat: PlayerSeat;
};

export class ExtortKeywordHandler extends KeywordHandler {
  static override readonly keyword = "extort" as const;

  override activate(_ast: KeywordAst, ctx: KeywordActivationContext): void {
    const card = ctx.game.cards.get(ctx.sourceCardId);
    if (!card) return;

    if (!card.keywords) card.keywords = new Set();
    card.keywords.add("extort");

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
        if (event.kind !== "SpellCast") return false;
        const p = event.payload as SpellCastPayload;
        return p.controllerSeat === controllerSeat;
      },

      resolver: {
        *resolve(gameUnknown: unknown): Generator<unknown, void, unknown> {
          const g = gameUnknown as Game;

          const response = (yield {
            kind: "decision",
            request: {
              kind: "confirmAction",
              sourceId: sourceCardId,
              prompt: "Pay {W/B} to extort?",
            },
          }) as { readonly kind: "confirmAction"; readonly confirmed: boolean } | undefined;
          if (response?.confirmed !== true) return;

          // TODO(advanced) — actual {W/B} payment goes through the cost
          // solver. MVP proceeds without charging.

          // Each opponent loses 1 life; controller gains the total drained.
          let drained = 0;
          for (const player of g.players) {
            if (player.seat === controllerSeat) continue;
            yield* g.action.changeLife(player.seat, -1, { cause: "extort" });
            drained += 1;
          }
          if (drained > 0) {
            yield* g.action.changeLife(controllerSeat, drained, { cause: "extort" });
          }
        },
      },
    };

    if (!card.triggeredAbilities) card.triggeredAbilities = [];
    card.triggeredAbilities.push(ta as unknown as TriggeredAbility);
    game.triggerRegistry.register(ta as unknown as TriggeredAbility);
  }

  override deactivate(_ast: KeywordAst, ctx: KeywordActivationContext): void {
    const card = ctx.game.cards.get(ctx.sourceCardId);
    card?.keywords?.delete("extort");
  }
}

keywordHandlerRegistry.register(ExtortKeywordHandler);
