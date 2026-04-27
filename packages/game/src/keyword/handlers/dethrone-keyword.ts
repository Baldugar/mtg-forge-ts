// SPDX-License-Identifier: GPL-3.0-or-later
// DethroneKeywordHandler — processes K:Dethrone keyword lines (Conspiracy,
// CR 702.105) and synthesizes a battlefield-zone TriggeredAbility that
// fires when the source attacks the player with the highest life total
// (or tied for it) and stamps a +1/+1 counter on the source.
//
// CR 702.105a — "Dethrone" — "Whenever this creature attacks the player
// with the most life or tied for the most life, put a +1/+1 counter on
// this creature."
//
// DSL form:
//   K:Dethrone     → no parameters
//
// MVP scope:
//   1. Adds "dethrone" to card.keywords.
//   2. Synthesizes one TriggeredAbility watching `AttackersDeclared`
//      whose attackers list contains self AND whose defender (a player)
//      currently has life ≥ all other players. On resolve: addCounter
//      P1P1 1 to self.
import type { EntityId, GameEvent, KeywordAst, PlayerSeat, TriggeredAbility } from "@mtg-forge-ts/core";
import { CounterType, ZoneType } from "@mtg-forge-ts/core";
import type { Game } from "../../game.js";
import type { StackItemResolver } from "../../stack/stack-item.js";
import { keywordHandlerRegistry } from "../keyword-handler-registry.js";
import type { KeywordActivationContext } from "../keyword-handler.js";
import { KeywordHandler } from "../keyword-handler.js";

type TriggeredAbilityWithResolver = TriggeredAbility & {
  readonly resolver: StackItemResolver | null;
};

type AttackerEntry = {
  readonly attackerId: EntityId;
  readonly defender:
    | { readonly kind: "player"; readonly seat: PlayerSeat }
    | { readonly kind: "planeswalker"; readonly id: EntityId }
    | { readonly kind: "battle"; readonly id: EntityId };
};
type AttackersDeclaredPayload = {
  readonly attackingSeat: PlayerSeat;
  readonly attackers?: readonly AttackerEntry[];
};

export class DethroneKeywordHandler extends KeywordHandler {
  static override readonly keyword = "dethrone" as const;

  override activate(_ast: KeywordAst, ctx: KeywordActivationContext): void {
    const card = ctx.game.cards.get(ctx.sourceCardId);
    if (!card) return;

    if (!card.keywords) card.keywords = new Set();
    card.keywords.add("dethrone");

    const game = ctx.game;
    const sourceCardId = ctx.sourceCardId;
    const controllerSeat = ctx.controllerSeat;
    const triggerId = game.newEntityId();

    let attackedPlayer: PlayerSeat | undefined;

    const ta: TriggeredAbilityWithResolver = {
      id: triggerId,
      kind: "triggered",
      sourceCardId,
      activeInZones: new Set([ZoneType.Battlefield]),
      timestamp: 0,
      controllerSeatAtReg: controllerSeat,
      isDelayed: false,

      matches(event: GameEvent): boolean {
        if (event.kind !== "AttackersDeclared") return false;
        const p = event.payload as AttackersDeclaredPayload;
        if (!p.attackers) return false;
        for (const a of p.attackers) {
          if (a.attackerId !== sourceCardId) continue;
          if (a.defender.kind !== "player") return false;
          attackedPlayer = a.defender.seat;
          return true;
        }
        return false;
      },

      resolver: {
        *resolve(gameUnknown: unknown): Generator<unknown, void, unknown> {
          const g = gameUnknown as Game;
          const target = attackedPlayer;
          if (target === undefined) return;
          // CR 702.105a — most life (or tied). Compute max life across
          // all players; the attacked player must equal that max.
          let maxLife = Number.NEGATIVE_INFINITY;
          for (const p of g.players) {
            if (p.life > maxLife) maxLife = p.life;
          }
          const attacked = g.players.find((p) => p.seat === target);
          if (!attacked) return;
          if (attacked.life < maxLife) return;
          yield* g.action.addCounter(sourceCardId, CounterType.PlusOnePlusOne, 1, sourceCardId);
        },
      },
    };

    if (!card.triggeredAbilities) card.triggeredAbilities = [];
    card.triggeredAbilities.push(ta as unknown as TriggeredAbility);
    game.triggerRegistry.register(ta as unknown as TriggeredAbility);
  }

  override deactivate(_ast: KeywordAst, ctx: KeywordActivationContext): void {
    const card = ctx.game.cards.get(ctx.sourceCardId);
    card?.keywords?.delete("dethrone");
  }
}

keywordHandlerRegistry.register(DethroneKeywordHandler);
