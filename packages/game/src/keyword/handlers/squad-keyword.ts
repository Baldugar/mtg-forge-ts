// SPDX-License-Identifier: GPL-3.0-or-later
// SquadKeywordHandler — processes K:Squad:<cost> keyword lines (The List
// / Dominaria United, CR 702.157) and stamps the squad cost on the source
// card so the cast pipeline can offer the per-payment-copy additional
// cost.
//
// CR 702.157a — "Squad [cost]" — "As an additional cost to cast this
// spell, you may pay [cost] any number of times. When this creature
// enters, create that many tokens that are copies of it."
//
// Wave 93 — closes the ETB token-copy synthesis TODO. The handler now:
//   1. Adds "squad" to card.keywords + stamps card.squadCost.
//   2. ETB trigger (CardChangedZone → Battlefield): reads
//      card.squadCount (populated by the cast-pipeline's per-payment
//      additional-cost loop) and calls game.action.createToken with
//      isCopy=true / count=squadCount, mirroring Embalm's token-copy
//      pattern. When squadCount is 0/undefined, the trigger no-ops.
import type { EntityId, GameEvent, KeywordAst, ParamValue, TriggeredAbility } from "@mtg-forge-ts/core";
import { ZoneType } from "@mtg-forge-ts/core";
import type { Game } from "../../game.js";
import type { StackItemResolver } from "../../stack/stack-item.js";
import { keywordHandlerRegistry } from "../keyword-handler-registry.js";
import type { KeywordActivationContext } from "../keyword-handler.js";
import { KeywordHandler } from "../keyword-handler.js";

type TriggeredAbilityWithResolver = TriggeredAbility & {
  readonly resolver: StackItemResolver | null;
};

export class SquadKeywordHandler extends KeywordHandler {
  static override readonly keyword = "squad" as const;

  override activate(ast: KeywordAst, ctx: KeywordActivationContext): void {
    const card = ctx.game.cards.get(ctx.sourceCardId);
    if (!card) return;

    if (!card.keywords) card.keywords = new Set();
    card.keywords.add("squad");

    const costParam = ast.params?.cost as ParamValue | undefined;
    const squadCost = costParam && costParam.kind === "literal" ? (costParam.raw as string) : "0";
    card.squadCost = squadCost;

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
          // CR 702.157a — "create that many tokens that are copies of
          // it." Reads squadCount stamped at cast time by the per-
          // payment confirm loop; 0/undefined → no tokens, no yield.
          const count = self.squadCount ?? 0;
          if (count <= 0) return;
          yield* g.action.createToken({
            paperCard: self.paperCard,
            controller: controllerSeat,
            count,
            isCopy: true,
            copyOf: sourceCardId,
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
    if (!card) return;
    card.keywords?.delete("squad");
    card.squadCost = undefined;
    card.squadCount = undefined;
  }
}

keywordHandlerRegistry.register(SquadKeywordHandler);
