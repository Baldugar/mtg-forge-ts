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
// Wave 79 scope:
//   1. Adds "amplify" to card.keywords.
//   2. Stamps `card.amplifyAmount = N`.
//   3. ETB trigger yields a chooseCard (min=0, max=eligible) over the
//      controller's hand of cards sharing a creature type with self;
//      emits CardsRevealed for the chosen set; addCounter(P1P1, n *
//      revealed.length) on self.
import type { EntityId, GameEvent, KeywordAst, ParamValue, TriggeredAbility } from "@mtg-forge-ts/core";
import { CounterType, ZoneType, mkEvent } from "@mtg-forge-ts/core";
import type { Game } from "../../game.js";
import type { StackItemResolver } from "../../stack/stack-item.js";
import { keywordHandlerRegistry } from "../keyword-handler-registry.js";
import type { KeywordActivationContext } from "../keyword-handler.js";
import { KeywordHandler } from "../keyword-handler.js";

type TriggeredAbilityWithResolver = TriggeredAbility & {
  readonly resolver: StackItemResolver | null;
};

/**
 * Read a card's creature subtypes off the layer-engine characteristics
 * (so subtype-changing effects are honoured). Returns a lower-cased Set.
 */
const creatureSubtypesOf = (game: Game, cardId: EntityId): Set<string> => {
  const out = new Set<string>();
  const chars = game.layerEngine.computeCharacteristics(cardId);
  for (const s of chars.subtypes) out.add(s.toLowerCase());
  return out;
};

export class AmplifyKeywordHandler extends KeywordHandler {
  static override readonly keyword = "amplify" as const;

  override activate(ast: KeywordAst, ctx: KeywordActivationContext): void {
    const card = ctx.game.cards.get(ctx.sourceCardId);
    if (!card) return;

    if (!card.keywords) card.keywords = new Set();
    card.keywords.add("amplify");

    // Wave 59 — keyword-line parser cleanup moved amplify into
    // AMOUNT_KEYWORDS, so the canonical slot is `amount`. The legacy
    // `detail` fallback is retained for snapshot-restore tolerance only.
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
        *resolve(gameUnknown: unknown): Generator<unknown, void, unknown> {
          const g = gameUnknown as Game;
          const self = g.cards.get(sourceCardId);
          if (!self) return;
          // CR 702.37a — "any number of cards from your hand that share
          // a creature type with it". Snapshot self's subtypes once, then
          // walk the controller's hand for matches.
          const ownSubs = creatureSubtypesOf(g, sourceCardId);
          if (ownSubs.size === 0) return;
          const handZone = g.getPlayer(controllerSeat).zones.get(ZoneType.Hand);
          if (!handZone) return;
          const eligible: EntityId[] = [];
          for (const id of handZone.toArray()) {
            if (id === sourceCardId) continue;
            const subs = creatureSubtypesOf(g, id);
            let shares = false;
            for (const s of subs) {
              if (ownSubs.has(s)) {
                shares = true;
                break;
              }
            }
            if (shares) eligible.push(id);
          }
          if (eligible.length === 0) return;

          const decision = (yield {
            kind: "decision",
            request: {
              kind: "chooseCard",
              playerSeat: controllerSeat,
              pool: eligible,
              restriction: { keyword: "amplify", n },
              min: 0,
              max: eligible.length,
            },
          }) as { readonly kind: "chooseCard"; readonly chosen: readonly EntityId[] } | undefined;
          if (!decision || decision.kind !== "chooseCard") return;
          const eligibleSet = new Set(eligible);
          const revealed: EntityId[] = [];
          for (const id of decision.chosen) {
            if (eligibleSet.has(id) && !revealed.includes(id)) revealed.push(id);
          }
          if (revealed.length === 0) return;

          // CR 701.15 — reveal the chosen cards (cards stay in hand).
          yield g.emitEvent(
            mkEvent("CardsRevealed", g.turn, g.phase, {
              revealedBy: controllerSeat,
              revealedTo: "all",
              cardIds: revealed,
              fromZone: ZoneType.Hand,
            }),
          );
          // Stamp N +1/+1 counters per revealed card.
          yield* g.action.addCounter(
            sourceCardId,
            CounterType.PlusOnePlusOne,
            n * revealed.length,
            sourceCardId,
          );
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
