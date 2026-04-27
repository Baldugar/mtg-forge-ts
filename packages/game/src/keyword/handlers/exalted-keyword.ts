// SPDX-License-Identifier: GPL-3.0-or-later
// ExaltedKeywordHandler — processes K:Exalted keyword lines (Shards of
// Alara, CR 702.82) and synthesizes a battlefield-zone TriggeredAbility
// that pumps the LONE attacker +1/+1 until end of turn.
//
// CR 702.82a — "Exalted" — "Whenever a creature you control attacks alone,
// it gets +1/+1 until end of turn."
//
// DSL form:
//   K:Exalted     → no parameters
//
// MVP scope:
//   1. Adds "exalted" to card.keywords.
//   2. Synthesizes one TriggeredAbility watching `AttackersDeclared`. The
//      matcher fires when the controller attacks with exactly ONE creature.
//   3. On resolve, register a Layer 7c +1/+1 effect with `untilEndOfTurn`
//      duration whose target is the lone attacker.
//
// CR note — Exalted stacks: each instance triggers separately, so a board
// with 3 exalted permanents gives the lone attacker +3/+3 cumulatively.
// This handler registers ONE trigger per instance; the trigger registry
// fires each one independently. The pump-effect's timestamp ordering is
// handled by Layer 7c's apply loop.
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
  readonly attackers?: readonly { readonly attackerId: EntityId }[];
};

export class ExaltedKeywordHandler extends KeywordHandler {
  static override readonly keyword = "exalted" as const;

  override activate(_ast: KeywordAst, ctx: KeywordActivationContext): void {
    const card = ctx.game.cards.get(ctx.sourceCardId);
    if (!card) return;

    if (!card.keywords) card.keywords = new Set();
    card.keywords.add("exalted");

    const game = ctx.game;
    const sourceCardId = ctx.sourceCardId;
    const controllerSeat = ctx.controllerSeat;
    const triggerId = game.newEntityId();

    let loneAttackerId: EntityId | undefined;

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
        if (p.attackingSeat !== controllerSeat) return false;
        if (p.attackers.length !== 1) return false;
        const lone = p.attackers[0];
        if (!lone) return false;
        loneAttackerId = lone.attackerId;
        return true;
      },

      resolver: {
        *resolve(gameUnknown: unknown): Generator<unknown, void, unknown> {
          const g = gameUnknown as Game;
          const target = loneAttackerId;
          if (target === undefined) return;
          const timestamp: number = g.newEntityId();
          const layer7c: Layer7cEffect = {
            kind: "modify",
            powerDelta: 1,
            toughnessDelta: 1,
            timestamp,
            sourceAbilityId: sourceCardId,
            targetCardIdFn: () => target,
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
    card?.keywords?.delete("exalted");
  }
}

keywordHandlerRegistry.register(ExaltedKeywordHandler);
