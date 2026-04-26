// SPDX-License-Identifier: GPL-3.0-or-later
// BushidoKeywordHandler — processes K:Bushido:N keyword lines (Champions
// of Kamigawa, CR 702.45) and synthesizes a battlefield-zone
// TriggeredAbility that pumps the source +N/+N until end of turn when
// it blocks or becomes blocked.
//
// CR 702.45a — "Bushido N" — "Whenever this creature blocks or becomes
// blocked, it gets +N/+N until end of turn."
//
// DSL form:
//   K:Bushido:1     → N = 1
//   K:Bushido:2     → N = 2
//
// MVP scope:
//   1. Adds "bushido" to card.keywords.
//   2. Synthesizes one TriggeredAbility watching `BlockersDeclared`. The
//      matcher fires when the source card is in the `blockerIds` of any
//      block (= "blocks") OR is the `attackerId` of a block whose
//      blockerIds is non-empty (= "becomes blocked"). On resolve, register
//      a Layer 7c +N/+N pump-effect with `untilEndOfTurn` duration on the
//      source.
import type {
  ContinuousEffect,
  EntityId,
  GameEvent,
  KeywordAst,
  ParamValue,
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

export class BushidoKeywordHandler extends KeywordHandler {
  static override readonly keyword = "bushido" as const;

  override activate(ast: KeywordAst, ctx: KeywordActivationContext): void {
    const card = ctx.game.cards.get(ctx.sourceCardId);
    if (!card) return;

    if (!card.keywords) card.keywords = new Set();
    card.keywords.add("bushido");

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
        if (event.kind !== "BlockersDeclared") return false;
        const { blocks } = event.payload as {
          readonly blocks: readonly {
            readonly attackerId: EntityId;
            readonly blockerIds: readonly EntityId[];
          }[];
        };
        if (!blocks || blocks.length === 0) return false;
        // Self is a blocker → "this creature blocks".
        for (const b of blocks) {
          if (b.blockerIds.includes(sourceCardId)) return true;
        }
        // Self is an attacker that got blocked → "becomes blocked".
        for (const b of blocks) {
          if (b.attackerId === sourceCardId && b.blockerIds.length > 0) return true;
        }
        return false;
      },

      resolver: {
        // biome-ignore lint/correctness/useYield: continuousEffectRegistry.register is synchronous; no EngineYield to emit
        *resolve(gameUnknown: unknown): Generator<unknown, void, unknown> {
          const g = gameUnknown as Game;
          const self = g.cards.get(sourceCardId);
          if (!self) return;
          if (self.zone !== ZoneType.Battlefield) return;

          const timestamp: number = g.newEntityId();
          const layer7c: Layer7cEffect = {
            kind: "modify",
            powerDelta: n,
            toughnessDelta: n,
            timestamp,
            sourceAbilityId: sourceCardId,
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
    card?.keywords?.delete("bushido");
  }
}

keywordHandlerRegistry.register(BushidoKeywordHandler);
