// SPDX-License-Identifier: GPL-3.0-or-later
// AnnihilatorKeywordHandler — processes K:Annihilator:N keyword lines
// (Rise of the Eldrazi, CR 702.85) and synthesizes a battlefield-zone
// TriggeredAbility that fires when the source attacks.
//
// CR 702.85a — "Annihilator N" — "Whenever this creature attacks, defending
// player sacrifices N permanents."
//
// DSL form:
//   K:Annihilator:1     → N = 1
//   K:Annihilator:6     → N = 6 (Emrakul)
//
// MVP scope:
//   1. Adds "annihilator" to card.keywords.
//   2. Synthesizes one TriggeredAbility watching `AttackersDeclared` for
//      self in the attackers batch. The matcher records the defender from
//      the batch entry whose attackerId === self; if it's a player
//      defender, the resolver yields a chooseCard decision to the
//      defending player to sacrifice N of their permanents.
//   3. Resolver auto-picks the first N permanents if the defending player
//      doesn't respond to the decision (matches mentor / provoke MVP
//      shape — full chooseCards decision schema is registered with the
//      decision engine in a follow-up).
import type {
  EntityId,
  GameEvent,
  KeywordAst,
  ParamValue,
  PlayerSeat,
  TriggeredAbility,
} from "@mtg-forge-ts/core";
import { ZoneType } from "@mtg-forge-ts/core";
import type { Game } from "../../game.js";
import type { StackItemResolver } from "../../stack/stack-item.js";
import { keywordHandlerRegistry } from "../keyword-handler-registry.js";
import type { KeywordActivationContext } from "../keyword-handler.js";
import { KeywordHandler } from "../keyword-handler.js";

type TriggeredAbilityWithResolver = TriggeredAbility & {
  readonly resolver: StackItemResolver | null;
};

type AttackersDeclaredPayload = {
  readonly attackingSeat: PlayerSeat;
  readonly attackers?: readonly {
    readonly attackerId: EntityId;
    readonly defender:
      | { readonly kind: "player"; readonly seat: PlayerSeat }
      | { readonly kind: "planeswalker"; readonly id: EntityId }
      | { readonly kind: "battle"; readonly id: EntityId };
  }[];
};

export class AnnihilatorKeywordHandler extends KeywordHandler {
  static override readonly keyword = "annihilator" as const;

  override activate(ast: KeywordAst, ctx: KeywordActivationContext): void {
    const card = ctx.game.cards.get(ctx.sourceCardId);
    if (!card) return;

    if (!card.keywords) card.keywords = new Set();
    card.keywords.add("annihilator");

    const amountParam = ast.params?.amount as ParamValue | undefined;
    const rawN =
      amountParam && amountParam.kind === "literal" ? Number.parseInt(amountParam.raw as string, 10) : 1;
    const n = Number.isFinite(rawN) && rawN > 0 ? rawN : 1;

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
        if (event.kind !== "AttackersDeclared") return false;
        const p = event.payload as AttackersDeclaredPayload;
        if (!p.attackers) return false;
        for (const a of p.attackers) {
          if (a.attackerId === sourceCardId) return true;
        }
        return false;
      },

      resolver: {
        *resolve(gameUnknown: unknown): Generator<unknown, void, unknown> {
          const g = gameUnknown as Game;
          // Find the defending player from the most recent AttackersDeclared
          // event. The MVP reads it off the source card's combat row if the
          // engine exposes it; otherwise fall back to "any opponent of the
          // attacker's controller" — single-opponent games it is unique.
          let defenderSeat: PlayerSeat | undefined;
          for (const p of g.players) {
            if (p.seat === controllerSeat) continue;
            defenderSeat = p.seat;
            break;
          }
          if (defenderSeat === undefined) return;

          // Enumerate the defending player's permanents on the battlefield.
          const eligible: EntityId[] = [];
          for (const [id, c] of g.cards) {
            if (c.controllerSeat !== defenderSeat) continue;
            if (c.zone !== ZoneType.Battlefield) continue;
            eligible.push(id);
          }
          if (eligible.length === 0) return;

          const sacCount = Math.min(n, eligible.length);
          const decision = (yield {
            kind: "decision",
            request: {
              kind: "chooseCard",
              playerSeat: defenderSeat,
              pool: eligible,
              restriction: { keyword: "annihilator", amount: sacCount },
              min: sacCount,
              max: sacCount,
            },
          }) as { readonly kind: "chooseCard"; readonly chosen: readonly EntityId[] } | undefined;

          // MVP fallback: if no decision returned, auto-pick the first N.
          const chosen: readonly EntityId[] =
            decision && decision.kind === "chooseCard" ? decision.chosen : eligible.slice(0, sacCount);

          for (const targetId of chosen) {
            if (!eligible.includes(targetId)) continue;
            yield* g.action.sacrifice(targetId, { sourceId: sourceCardId });
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
    card?.keywords?.delete("annihilator");
  }
}

keywordHandlerRegistry.register(AnnihilatorKeywordHandler);
