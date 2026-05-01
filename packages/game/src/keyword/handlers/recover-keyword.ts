// SPDX-License-Identifier: GPL-3.0-or-later
// RecoverKeywordHandler — processes K:Recover:<cost> keyword lines
// (Saviors of Kamigawa, CR 702.59) and stamps a Graveyard-zone trigger
// that watches creature deaths under the controller.
//
// CR 702.59a — "Recover [cost] (When a creature is put into your
// graveyard from the battlefield, you may pay [cost]. If you do, return
// this card from your graveyard to your hand. Otherwise, exile it.)"
//
// MVP scope:
//   1. Adds "recover" to card.keywords.
//   2. Stamps a triggered ability active in Graveyard. matches() fires
//      on CardChangedZone Battlefield → Graveyard for any Creature.YouCtrl
//      (excluding self). resolve() yields a confirmAction. On confirm:
//      attempt to pay <cost> via the cost-pipeline; if paid, return self
//      to Hand. On decline OR cost failure: exile self.
//
// Wave 79 — The Recover cost is now paid through parseCostString /
// payCost (mirroring the Wave 29 echo loop). On confirm + successful
// payment: return self to hand. On decline OR payment failure: exile
// self. The cost-payment infra handles mana solving, X bind, and
// ManaSpent emits identically to other "pay X to do Y" triggers.
import type { EntityId, GameEvent, KeywordAst, ParamValue, TriggeredAbility } from "@mtg-forge-ts/core";
import { CardType, ZoneType } from "@mtg-forge-ts/core";
import type { CostPaymentContext } from "../../cost/parts/cost-part.js";
import { parseCostString, payCost } from "../../cost/parts/cost-payment.js";
import type { Game } from "../../game.js";
import type { StackItemResolver } from "../../stack/stack-item.js";
import { keywordHandlerRegistry } from "../keyword-handler-registry.js";
import type { KeywordActivationContext } from "../keyword-handler.js";
import { KeywordHandler } from "../keyword-handler.js";

type TriggeredAbilityWithResolver = TriggeredAbility & {
  readonly resolver: StackItemResolver | null;
};

export class RecoverKeywordHandler extends KeywordHandler {
  static override readonly keyword = "recover" as const;

  override activate(ast: KeywordAst, ctx: KeywordActivationContext): void {
    const card = ctx.game.cards.get(ctx.sourceCardId);
    if (!card) return;

    if (!card.keywords) card.keywords = new Set();
    card.keywords.add("recover");

    const costParam = ast.params?.cost as ParamValue | undefined;
    const recoverCost = costParam && costParam.kind === "literal" ? (costParam.raw as string) : "0";

    const game = ctx.game;
    const sourceCardId = ctx.sourceCardId;
    const controllerSeat = ctx.controllerSeat;

    const triggerId = game.newEntityId();
    const ta: TriggeredAbilityWithResolver = {
      id: triggerId,
      kind: "triggered",
      sourceCardId,
      activeInZones: new Set([ZoneType.Graveyard]),
      timestamp: 0,
      controllerSeatAtReg: controllerSeat,
      isDelayed: false,
      matches(event: GameEvent): boolean {
        if (event.kind !== "CardChangedZone") return false;
        const p = event.payload as {
          readonly cardId: EntityId;
          readonly fromZone: ZoneType;
          readonly toZone: ZoneType;
        };
        if (p.fromZone !== ZoneType.Battlefield) return false;
        if (p.toZone !== ZoneType.Graveyard) return false;
        if (p.cardId === sourceCardId) return false; // not on self LTB.
        const dying = game.cards.get(p.cardId);
        if (!dying) return false;
        // Owner check via LKI controller (sticky on Card after zone move).
        if (dying.controllerSeat !== controllerSeat && dying.ownerSeat !== controllerSeat) return false;
        // Was a creature on the battlefield. Use the LKI types.
        const chars = game.layerEngine.computeCharacteristics(p.cardId);
        return chars.types.has(CardType.Creature);
      },
      resolver: {
        *resolve(gameUnknown: unknown): Generator<unknown, void, unknown> {
          const g = gameUnknown as Game;
          const self = g.cards.get(sourceCardId);
          if (!self) return;
          if (self.zone !== ZoneType.Graveyard) return;

          const response = (yield {
            kind: "decision",
            request: {
              kind: "confirmAction",
              sourceId: sourceCardId,
              prompt: `Pay ${recoverCost} to return ${self.paperCard.name} from graveyard to hand? (Otherwise it is exiled.)`,
            },
          }) as { readonly kind: "confirmAction"; readonly confirmed: boolean } | undefined;

          if (response?.confirmed === true) {
            // Run the recover cost through the cost-payment infra. On
            // success: return self to hand. On failure (insufficient
            // resources / cost throws): fall through to exile.
            let paid = false;
            try {
              const plan = parseCostString(recoverCost);
              const ctx: CostPaymentContext = {
                game: g,
                payerSeat: self.ownerSeat,
                sourceCardId,
                raw: recoverCost,
                kind: "ability",
                sourceZone: ZoneType.Graveyard,
              };
              yield* payCost(plan, ctx);
              paid = true;
            } catch {
              paid = false;
            }
            if (paid) {
              yield* g.action.moveTo(sourceCardId, ZoneType.Hand, {
                toSeat: self.ownerSeat,
                cause: "recover",
              });
              return;
            }
          }

          // Declined (or cost failed): exile self.
          yield* g.action.moveTo(sourceCardId, ZoneType.Exile, {
            toSeat: self.ownerSeat,
            cause: "recover",
          });
        },
      },
    };

    if (!card.triggeredAbilities) card.triggeredAbilities = [];
    card.triggeredAbilities.push(ta as unknown as TriggeredAbility);
    game.triggerRegistry.register(ta as unknown as TriggeredAbility);
  }

  override deactivate(_ast: KeywordAst, ctx: KeywordActivationContext): void {
    const card = ctx.game.cards.get(ctx.sourceCardId);
    card?.keywords?.delete("recover");
  }
}

keywordHandlerRegistry.register(RecoverKeywordHandler);
