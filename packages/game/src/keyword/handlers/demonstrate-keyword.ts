// SPDX-License-Identifier: GPL-3.0-or-later
// DemonstrateKeywordHandler — processes K:Demonstrate keyword lines
// (Strixhaven: Mystical Archive, CR 702.144) and synthesizes a SpellCast
// self-trigger that yields confirmAction (own copy) and a per-opponent
// confirmAction (opponent copy).
//
// CR 702.144a — "Demonstrate" — "When you cast this spell, you may copy
// it. If you do, choose an opponent to copy it as well."
//
// MVP scope:
//   1. Adds "demonstrate" to card.keywords.
//   2. SpellCast self-trigger fires when the SpellCast event names the
//      source card. On resolve: yield confirmAction; if confirmed, the
//      copy-and-opponent-copy synthesis happens via the cast pipeline
//      (TODO(advanced)). The trigger registration captures the durable
//      contract.
import type { EntityId, GameEvent, KeywordAst, TriggeredAbility } from "@mtg-forge-ts/core";
import { ZoneType } from "@mtg-forge-ts/core";
import type { StackItemResolver } from "../../stack/stack-item.js";
import { keywordHandlerRegistry } from "../keyword-handler-registry.js";
import type { KeywordActivationContext } from "../keyword-handler.js";
import { KeywordHandler } from "../keyword-handler.js";

type TriggeredAbilityWithResolver = TriggeredAbility & {
  readonly resolver: StackItemResolver | null;
};

export class DemonstrateKeywordHandler extends KeywordHandler {
  static override readonly keyword = "demonstrate" as const;

  override activate(_ast: KeywordAst, ctx: KeywordActivationContext): void {
    const card = ctx.game.cards.get(ctx.sourceCardId);
    if (!card) return;

    if (!card.keywords) card.keywords = new Set();
    card.keywords.add("demonstrate");

    const game = ctx.game;
    const sourceCardId = ctx.sourceCardId;
    const controllerSeat = ctx.controllerSeat;
    const triggerId = game.newEntityId();

    const ta: TriggeredAbilityWithResolver = {
      id: triggerId,
      kind: "triggered",
      sourceCardId,
      // Demonstrate fires while the spell is on the stack (the source
      // card is in the Stack zone). The trigger registry checks the
      // active-zones set against the card's current zone at firing
      // time; we list both Stack and Battlefield to cover the brief
      // moment the SpellCast event fires before the card lands.
      activeInZones: new Set([ZoneType.Stack, ZoneType.Battlefield]),
      timestamp: 0,
      controllerSeatAtReg: controllerSeat,
      isDelayed: false,

      matches(event: GameEvent): boolean {
        if (event.kind !== "SpellCast") return false;
        const p = event.payload as { readonly cardId: EntityId };
        return p.cardId === sourceCardId;
      },

      resolver: {
        *resolve(): Generator<unknown, void, unknown> {
          const response = (yield {
            kind: "decision",
            request: {
              kind: "confirmAction",
              sourceId: sourceCardId,
              prompt: "Demonstrate: copy the spell?",
            },
          }) as { readonly kind: "confirmAction"; readonly confirmed: boolean } | undefined;
          if (response?.confirmed !== true) return;
          // TODO(advanced) — synthesize own copy + opponent's copy via
          // the cast-copy pipeline.
        },
      },
    };

    if (!card.triggeredAbilities) card.triggeredAbilities = [];
    card.triggeredAbilities.push(ta as unknown as TriggeredAbility);
    game.triggerRegistry.register(ta as unknown as TriggeredAbility);
  }

  override deactivate(_ast: KeywordAst, ctx: KeywordActivationContext): void {
    const card = ctx.game.cards.get(ctx.sourceCardId);
    card?.keywords?.delete("demonstrate");
  }
}

keywordHandlerRegistry.register(DemonstrateKeywordHandler);
