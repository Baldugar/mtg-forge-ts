// SPDX-License-Identifier: GPL-3.0-or-later
// ForMirrodinKeywordHandler — processes K:For Mirrodin keyword lines
// (Mirrodin Besieged, CR 702.158) and synthesizes an ETB triggered ability
// that creates a 2/2 Rebel creature token and attaches the source equipment
// to it.
//
// CR 702.158a — "For Mirrodin!" — "When this Equipment enters the
// battlefield, create a 2/2 red Rebel creature token, then attach this
// Equipment to it."
//
// MVP scope:
//   1. Adds "for_mirrodin" to card.keywords.
//   2. Stamps `card.forMirrodin = true`.
//   3. Synthesizes one ETB-trigger watching CardChangedZone(self →
//      Battlefield). The token-creation + attach resolution is documented
//      under TODO(advanced); the trigger registration captures the durable
//      contract so Wave 51's Count$ForMirrodin selectors can read it.
import type { EntityId, GameEvent, KeywordAst, TriggeredAbility, ZoneType as ZT } from "@mtg-forge-ts/core";
import { ZoneType } from "@mtg-forge-ts/core";
import type { StackItemResolver } from "../../stack/stack-item.js";
import { keywordHandlerRegistry } from "../keyword-handler-registry.js";
import type { KeywordActivationContext } from "../keyword-handler.js";
import { KeywordHandler } from "../keyword-handler.js";

type TriggeredAbilityWithResolver = TriggeredAbility & {
  readonly resolver: StackItemResolver | null;
};

export class ForMirrodinKeywordHandler extends KeywordHandler {
  static override readonly keyword = "for_mirrodin" as const;

  override activate(_ast: KeywordAst, ctx: KeywordActivationContext): void {
    const card = ctx.game.cards.get(ctx.sourceCardId);
    if (!card) return;
    if (!card.keywords) card.keywords = new Set();
    card.keywords.add("for_mirrodin");
    card.forMirrodin = true;

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
        if (event.kind !== "CardChangedZone") return false;
        const p = event.payload as { cardId: EntityId; toZone: ZT };
        return p.cardId === sourceCardId && p.toZone === ZoneType.Battlefield;
      },
      resolver: {
        // biome-ignore lint/correctness/useYield: MVP no-op until token + attach lands
        *resolve(): Generator<unknown, void, unknown> {
          // TODO(advanced) — create a 2/2 red Rebel token and attach self to it.
          return;
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
    card.keywords?.delete("for_mirrodin");
    card.forMirrodin = undefined;
  }
}

keywordHandlerRegistry.register(ForMirrodinKeywordHandler);
