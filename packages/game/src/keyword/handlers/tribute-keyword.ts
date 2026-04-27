// SPDX-License-Identifier: GPL-3.0-or-later
// TributeKeywordHandler — processes K:Tribute:N keyword lines (Born of
// the Gods, CR 702.110) and synthesizes an ETB trigger that yields a
// confirmAction to an opponent. If they confirm: addCounter +1/+1 N. If
// they decline: trigger the alternate effect (TODO(advanced)).
//
// CR 702.110a — "Tribute N" — "As this creature enters, an opponent of
// your choice may put N +1/+1 counters on it. If they don't, the
// alternate trigger fires."
//
// MVP scope:
//   1. Adds "tribute" to card.keywords.
//   2. Stamps `card.tributeAmount = N`.
//   3. ETB trigger: yield confirmAction. On confirm: addCounter(P1P1, N)
//      and stamp `card.tributePaid = true`. On decline: stamp
//      `card.tributePaid = false`. The alternate-trigger dispatch on
//      decline is TODO(advanced) — Forge encodes the alternate as a
//      Conditional Trigger gated on Count$Tribute.
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

export class TributeKeywordHandler extends KeywordHandler {
  static override readonly keyword = "tribute" as const;

  override activate(ast: KeywordAst, ctx: KeywordActivationContext): void {
    const card = ctx.game.cards.get(ctx.sourceCardId);
    if (!card) return;

    if (!card.keywords) card.keywords = new Set();
    card.keywords.add("tribute");

    const amountParam = ast.params?.amount as ParamValue | undefined;
    const rawN =
      amountParam && amountParam.kind === "literal" ? Number.parseInt(amountParam.raw as string, 10) : 1;
    const n = Number.isFinite(rawN) && rawN > 0 ? rawN : 1;
    card.tributeAmount = n;

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
          const response = (yield {
            kind: "decision",
            request: {
              kind: "confirmAction",
              sourceId: sourceCardId,
              prompt: `Opponent: pay tribute (put ${n} +1/+1 counters)?`,
            },
          }) as { readonly kind: "confirmAction"; readonly confirmed: boolean } | undefined;
          if (response?.confirmed === true) {
            self.tributePaid = true;
            yield* g.action.addCounter(sourceCardId, CounterType.PlusOnePlusOne, n, sourceCardId);
          } else {
            self.tributePaid = false;
            // TODO(advanced) — fire the alternate trigger encoded on the
            // source as a Conditional Trigger gated on Count$Tribute.
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
    if (!card) return;
    card.keywords?.delete("tribute");
    card.tributeAmount = undefined;
    card.tributePaid = undefined;
  }
}

keywordHandlerRegistry.register(TributeKeywordHandler);
