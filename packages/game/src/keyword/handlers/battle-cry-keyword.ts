// SPDX-License-Identifier: GPL-3.0-or-later
// BattleCryKeywordHandler — processes K:Battle cry keyword lines (Mirrodin
// Besieged, CR 702.91) and synthesizes a battlefield-zone TriggeredAbility
// that pumps every OTHER attacking creature +1/+0 until end of turn.
//
// CR 702.91a — "Battle cry" — "Whenever this creature attacks, each other
// attacking creature gets +1/+0 until end of turn."
//
// DSL form:
//   K:Battle cry      → no parameters
//
// MVP scope:
//   1. Adds "battle_cry" to card.keywords.
//   2. Synthesizes one TriggeredAbility watching `AttackersDeclared` for
//      self in the attackers batch.
//   3. On resolve, register a Layer 7c +1/+0 effect with `untilEndOfTurn`
//      duration whose `appliesToCardIdFn` predicate selects every other
//      attacker in the batch (read off the live event payload via the
//      engine's recent-event log fallback — for MVP we instead enumerate
//      battlefield creatures with `attacking === true`, mirroring mentor;
//      since the soft predicate is broad, the result is correct in
//      practice for solo-attacker boards and a strict overcount for
//      multi-attacker boards is bounded by the OTHER predicate).
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

export class BattleCryKeywordHandler extends KeywordHandler {
  static override readonly keyword = "battle_cry" as const;

  override activate(_ast: KeywordAst, ctx: KeywordActivationContext): void {
    const card = ctx.game.cards.get(ctx.sourceCardId);
    if (!card) return;

    if (!card.keywords) card.keywords = new Set();
    card.keywords.add("battle_cry");

    const game = ctx.game;
    const sourceCardId = ctx.sourceCardId;
    const controllerSeat = ctx.controllerSeat;
    const triggerId = game.newEntityId();

    // Snapshot the most recent AttackersDeclared payload so the resolver
    // can scope the pump to the OTHER attackers in the batch. Captured by
    // closure on each match; the resolver reads it back on resolve.
    let lastBatch: readonly EntityId[] = [];

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
        const ids: EntityId[] = [];
        for (const a of p.attackers) {
          ids.push(a.attackerId);
          if (a.attackerId === sourceCardId) selfFound = true;
        }
        if (!selfFound) return false;
        lastBatch = ids;
        return true;
      },

      resolver: {
        *resolve(gameUnknown: unknown): Generator<unknown, void, unknown> {
          const g = gameUnknown as Game;
          const others = lastBatch.filter((id) => id !== sourceCardId);
          if (others.length === 0) return;

          const otherSet = new Set<EntityId>(others);
          const timestamp: number = g.newEntityId();
          const layer7c: Layer7cEffect = {
            kind: "modify",
            powerDelta: 1,
            toughnessDelta: 0,
            timestamp,
            sourceAbilityId: sourceCardId,
            appliesToCardIdFn: (cid: EntityId) => otherSet.has(cid),
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
    card?.keywords?.delete("battle_cry");
  }
}

keywordHandlerRegistry.register(BattleCryKeywordHandler);
