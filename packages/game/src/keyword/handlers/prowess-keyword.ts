// SPDX-License-Identifier: GPL-3.0-or-later
// ProwessKeywordHandler — processes K:Prowess keyword lines (Khans of
// Tarkir, CR 702.108) and synthesizes a battlefield-zone TriggeredAbility
// that pumps self +1/+1 until end of turn whenever the controller casts a
// noncreature spell.
//
// CR 702.108a — "Prowess" — "Whenever you cast a noncreature spell, this
// creature gets +1/+1 until end of turn."
//
// DSL form:
//   K:Prowess     → no parameters
//
// MVP scope:
//   1. Adds "prowess" to card.keywords.
//   2. Synthesizes one TriggeredAbility watching `SpellCast` whose
//      controllerSeat matches self's controller AND whose source card is
//      not a creature spell (read from layerEngine characteristics).
//   3. On resolve, register a Layer 7c +1/+1 effect with `untilEndOfTurn`
//      duration targeting self.
import type {
  ContinuousEffect,
  EntityId,
  GameEvent,
  KeywordAst,
  PlayerSeat,
  TriggeredAbility,
} from "@mtg-forge-ts/core";
import { CardType, Layer, ZoneType } from "@mtg-forge-ts/core";
import type { Game } from "../../game.js";
import type { Layer7cEffect } from "../../layers/layer7-pt.js";
import type { StackItemResolver } from "../../stack/stack-item.js";
import { keywordHandlerRegistry } from "../keyword-handler-registry.js";
import type { KeywordActivationContext } from "../keyword-handler.js";
import { KeywordHandler } from "../keyword-handler.js";

type TriggeredAbilityWithResolver = TriggeredAbility & {
  readonly resolver: StackItemResolver | null;
};

type SpellCastPayload = {
  readonly stackItemId: EntityId;
  readonly cardId: EntityId;
  readonly controllerSeat: PlayerSeat;
};

export class ProwessKeywordHandler extends KeywordHandler {
  static override readonly keyword = "prowess" as const;

  override activate(_ast: KeywordAst, ctx: KeywordActivationContext): void {
    const card = ctx.game.cards.get(ctx.sourceCardId);
    if (!card) return;

    if (!card.keywords) card.keywords = new Set();
    card.keywords.add("prowess");

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
        if (event.kind !== "SpellCast") return false;
        const p = event.payload as SpellCastPayload;
        if (p.controllerSeat !== controllerSeat) return false;
        // Exclude creature spells.
        const chars = game.layerEngine.computeCharacteristics(p.cardId);
        if (chars.types.has(CardType.Creature)) return false;
        return true;
      },

      resolver: {
        *resolve(gameUnknown: unknown): Generator<unknown, void, unknown> {
          const g = gameUnknown as Game;
          const self = g.cards.get(sourceCardId);
          if (!self) return;
          if (self.zone !== ZoneType.Battlefield) return;

          const timestamp: number = g.newEntityId();
          const layer7c: Layer7cEffect = {
            kind: "modify",
            powerDelta: 1,
            toughnessDelta: 1,
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
    card?.keywords?.delete("prowess");
  }
}

keywordHandlerRegistry.register(ProwessKeywordHandler);
