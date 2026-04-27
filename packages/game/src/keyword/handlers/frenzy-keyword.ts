// SPDX-License-Identifier: GPL-3.0-or-later
// FrenzyKeywordHandler — processes K:Frenzy:N keyword lines (Shadowmoor,
// CR 702.36) and synthesizes a battlefield-zone TriggeredAbility that
// pumps the source +N/+0 until end of turn whenever it attacks and is
// unblocked.
//
// CR 702.36a — "Frenzy N" — "Whenever this creature attacks and isn't
// blocked, it gets +N/+0 until end of turn."
//
// MVP scope:
//   1. Adds "frenzy" to card.keywords.
//   2. Stamps `card.frenzyAmount = N`.
//   3. Synthesizes one TriggeredAbility watching `AttackerUnblocked` with
//      attackerId === self. On resolve: register a Layer 7c +N/+0 pump-
//      effect with `untilEndOfTurn` duration.
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

export class FrenzyKeywordHandler extends KeywordHandler {
  static override readonly keyword = "frenzy" as const;

  override activate(ast: KeywordAst, ctx: KeywordActivationContext): void {
    const card = ctx.game.cards.get(ctx.sourceCardId);
    if (!card) return;
    if (!card.keywords) card.keywords = new Set();
    card.keywords.add("frenzy");
    const amountParam = ast.params?.amount as ParamValue | undefined;
    const rawN =
      amountParam && amountParam.kind === "literal" ? Number.parseInt(amountParam.raw as string, 10) : 1;
    const n = Number.isFinite(rawN) && rawN > 0 ? rawN : 1;
    card.frenzyAmount = n;

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
        if (event.kind !== "AttackerUnblocked") return false;
        const p = event.payload as { attackerId: EntityId };
        return p.attackerId === sourceCardId;
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
            toughnessDelta: 0,
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
    if (!card) return;
    card.keywords?.delete("frenzy");
    card.frenzyAmount = undefined;
  }
}

keywordHandlerRegistry.register(FrenzyKeywordHandler);
