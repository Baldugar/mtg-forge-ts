// SPDX-License-Identifier: GPL-3.0-or-later
// AmplifyKeywordHandler — processes K:Amplify:N keyword lines (Onslaught,
// CR 702.37) and synthesizes an ETB trigger that yields a chooseCards
// from the controller's hand to reveal sharing-creature-type cards;
// addCounter(+1/+1) per revealed.
//
// CR 702.37a — "Amplify N" — "As this creature enters, you may reveal
// any number of cards from your hand that share a creature type with
// it. This creature enters with N +1/+1 counters on it for each card
// revealed this way."
//
// MVP scope:
//   1. Adds "amplify" to card.keywords.
//   2. Stamps `card.amplifyAmount = N`.
//   3. ETB trigger: MVP auto-reveal-zero (counters are 0). The full
//      chooseCards-from-hand decision is TODO(advanced).
import type { EntityId, GameEvent, KeywordAst, ParamValue, TriggeredAbility } from "@mtg-forge-ts/core";
import { ZoneType } from "@mtg-forge-ts/core";
import type { StackItemResolver } from "../../stack/stack-item.js";
import { keywordHandlerRegistry } from "../keyword-handler-registry.js";
import type { KeywordActivationContext } from "../keyword-handler.js";
import { KeywordHandler } from "../keyword-handler.js";

type TriggeredAbilityWithResolver = TriggeredAbility & {
  readonly resolver: StackItemResolver | null;
};

export class AmplifyKeywordHandler extends KeywordHandler {
  static override readonly keyword = "amplify" as const;

  override activate(ast: KeywordAst, ctx: KeywordActivationContext): void {
    const card = ctx.game.cards.get(ctx.sourceCardId);
    if (!card) return;

    if (!card.keywords) card.keywords = new Set();
    card.keywords.add("amplify");

    // amplify isn't in any of the parser's slot sets — accept either
    // "amount" or "detail".
    const amountParam =
      (ast.params?.amount as ParamValue | undefined) ?? (ast.params?.detail as ParamValue | undefined);
    const rawN =
      amountParam && amountParam.kind === "literal" ? Number.parseInt(amountParam.raw as string, 10) : 1;
    const n = Number.isFinite(rawN) && rawN > 0 ? rawN : 1;
    card.amplifyAmount = n;

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
        const p = event.payload as { cardId: EntityId; toZone: ZoneType };
        return p.cardId === sourceCardId && p.toZone === ZoneType.Battlefield;
      },

      resolver: {
        // biome-ignore lint/correctness/useYield: MVP no-op until chooseCards lands
        *resolve(): Generator<unknown, void, unknown> {
          // TODO(advanced) — chooseCards from hand sharing a creature
          // type with self; addCounter(P1P1, n * revealed).
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
    card.keywords?.delete("amplify");
    card.amplifyAmount = undefined;
  }
}

keywordHandlerRegistry.register(AmplifyKeywordHandler);
