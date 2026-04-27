// SPDX-License-Identifier: GPL-3.0-or-later
// MeleeKeywordHandler — processes K:Melee keyword lines (Khans of Tarkir,
// CR 702.121) and synthesizes a battlefield-zone TriggeredAbility that
// pumps self +1/+1 per opponent the controller attacked this combat.
//
// CR 702.121a — "Melee" — "Whenever this creature attacks, it gets +1/+1
// until end of turn for each opponent you attacked this combat."
//
// DSL form:
//   K:Melee     → no parameters
//
// MVP scope:
//   1. Adds "melee" to card.keywords.
//   2. Synthesizes one TriggeredAbility watching `AttackersDeclared` for
//      self in attackers batch.
//   3. On resolve, count distinct opponent seats targeted by attackers
//      from the controller in the live event payload; register a Layer 7c
//      +N/+N effect with `untilEndOfTurn` duration targeting self.
import type {
  ContinuousEffect,
  EntityId,
  GameEvent,
  KeywordAst,
  PlayerSeat,
  TriggeredAbility,
} from "@mtg-forge-ts/core";
import { Layer, ZoneType } from "@mtg-forge-ts/core";
import type { Game } from "../../game.js";
import type { Layer7cEffect } from "../../layers/layer7-pt.js";
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

export class MeleeKeywordHandler extends KeywordHandler {
  static override readonly keyword = "melee" as const;

  override activate(_ast: KeywordAst, ctx: KeywordActivationContext): void {
    const card = ctx.game.cards.get(ctx.sourceCardId);
    if (!card) return;

    if (!card.keywords) card.keywords = new Set();
    card.keywords.add("melee");

    const game = ctx.game;
    const sourceCardId = ctx.sourceCardId;
    const controllerSeat = ctx.controllerSeat;
    const triggerId = game.newEntityId();

    let opponentsAttacked = 0;

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
        let selfFound = false;
        const opps = new Set<PlayerSeat>();
        for (const a of p.attackers) {
          if (a.attackerId === sourceCardId) selfFound = true;
          // Resolve the defending player seat: direct on player attacks,
          // or the controller of the planeswalker / battle being attacked.
          let seat: PlayerSeat | undefined;
          if (a.defender.kind === "player") seat = a.defender.seat;
          else {
            const def = game.cards.get(a.defender.id);
            if (def) seat = def.controllerSeat;
          }
          if (seat !== undefined && seat !== p.attackingSeat) opps.add(seat);
        }
        if (!selfFound) return false;
        opponentsAttacked = opps.size;
        return true;
      },

      resolver: {
        *resolve(gameUnknown: unknown): Generator<unknown, void, unknown> {
          const g = gameUnknown as Game;
          const n = opponentsAttacked;
          if (n <= 0) return;
          const timestamp: number = g.newEntityId();
          const layer7c: Layer7cEffect = {
            kind: "modify",
            powerDelta: n,
            toughnessDelta: n,
            timestamp,
            sourceAbilityId: sourceCardId,
            targetCardIdFn: () => sourceCardId,
          };
          const effect: ContinuousEffect = {
            id: g.newEntityId(),
            sourceCardId,
            timestamp,
            layer: Layer.L7c_PTModify,
            duration: { kind: "untilEndOfTurn" },
            payload: { kind: "pt-modify", effect: layer7c },
          };
          g.continuousEffectRegistry.register(effect);
        },
      },
    };

    if (!card.triggeredAbilities) card.triggeredAbilities = [];
    card.triggeredAbilities.push(ta as unknown as TriggeredAbility);
    game.triggerRegistry.register(ta as unknown as TriggeredAbility);
  }

  override deactivate(_ast: KeywordAst, ctx: KeywordActivationContext): void {
    const card = ctx.game.cards.get(ctx.sourceCardId);
    card?.keywords?.delete("melee");
  }
}

keywordHandlerRegistry.register(MeleeKeywordHandler);
