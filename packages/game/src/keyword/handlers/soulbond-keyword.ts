// SPDX-License-Identifier: GPL-3.0-or-later
// SoulbondKeywordHandler — processes K:Soulbond keyword lines (Avacyn
// Restored, CR 702.94) and synthesizes ETB-pair-with-creature plus
// bidirectional cleanup triggers.
//
// CR 702.94a — "Soulbond — You may pair this creature with another
// unpaired creature when either enters the battlefield. They remain paired
// for as long as you control both of them."
//
// DSL form:
//   K:Soulbond     (no parameters)
//
// MVP scope:
//   1. Adds "soulbond" to card.keywords.
//   2. Synthesizes an ETB trigger that yields chooseCard over creatures
//      the controller controls that are unpaired and not self. If chosen,
//      stamps `card.pairedWith` on both cards (bidirectional). The
//      "abilities apply while paired" portion of each Soulbond card is
//      card-specific (each card has its own conditional Static / Trigger
//      keyed off `pairedWith !== undefined`); pair-state tracking is the
//      keyword's portion.
//   3. Synthesizes a cleanup trigger on CardChangedZone(this → not-BF)
//      that clears `pairedWith` on both halves. (Controller-change
//      cleanup is deferred to SP4 polish; the cards' own static
//      conditions guard on `pairedWith !== undefined` so the slot is the
//      authoritative state.)
import type { EntityId, GameEvent, KeywordAst, TriggeredAbility } from "@mtg-forge-ts/core";
import { CardType, ZoneType } from "@mtg-forge-ts/core";
import type { Game } from "../../game.js";
import type { StackItemResolver } from "../../stack/stack-item.js";
import { keywordHandlerRegistry } from "../keyword-handler-registry.js";
import type { KeywordActivationContext } from "../keyword-handler.js";
import { KeywordHandler } from "../keyword-handler.js";

type TriggeredAbilityWithResolver = TriggeredAbility & {
  readonly resolver: StackItemResolver | null;
};

export class SoulbondKeywordHandler extends KeywordHandler {
  static override readonly keyword = "soulbond" as const;

  override activate(_ast: KeywordAst, ctx: KeywordActivationContext): void {
    const card = ctx.game.cards.get(ctx.sourceCardId);
    if (!card) return;

    if (!card.keywords) card.keywords = new Set();
    card.keywords.add("soulbond");

    const game = ctx.game;
    const sourceCardId = ctx.sourceCardId;
    const controllerSeat = ctx.controllerSeat;

    // ETB trigger — pair with an unpaired creature you control.
    const etbId = game.newEntityId();
    const etb: TriggeredAbilityWithResolver = {
      id: etbId,
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
          if (self.pairedWith !== undefined) return; // already paired

          // Eligible: creatures the controller controls, unpaired, not
          // self. Soulbond CR text says "another unpaired creature" — no
          // restriction that the partner also have Soulbond, so any
          // unpaired creature qualifies.
          const eligible: EntityId[] = [];
          for (const [id, c] of g.cards) {
            if (id === sourceCardId) continue;
            if (c.controllerSeat !== controllerSeat) continue;
            if (c.zone !== ZoneType.Battlefield) continue;
            if (c.pairedWith !== undefined) continue;
            const chars = g.layerEngine.computeCharacteristics(id);
            if (!chars.types.has(CardType.Creature)) continue;
            eligible.push(id);
          }
          if (eligible.length === 0) return;

          const decision = (yield {
            kind: "decision",
            request: {
              kind: "chooseCard",
              playerSeat: controllerSeat,
              pool: eligible,
              restriction: { keyword: "soulbond" },
              min: 0,
              max: 1,
            },
          }) as { readonly kind: "chooseCard"; readonly chosen: readonly EntityId[] } | undefined;
          if (!decision || decision.kind !== "chooseCard") return;
          const partnerId = decision.chosen[0];
          if (partnerId === undefined) return;
          if (!eligible.includes(partnerId)) return;
          const partner = g.cards.get(partnerId);
          if (!partner) return;
          if (partner.pairedWith !== undefined) return; // raced

          self.pairedWith = partnerId;
          partner.pairedWith = sourceCardId;
        },
      },
    };
    if (!card.triggeredAbilities) card.triggeredAbilities = [];
    card.triggeredAbilities.push(etb as unknown as TriggeredAbility);
    game.triggerRegistry.register(etb as unknown as TriggeredAbility);

    // LTB cleanup trigger — when this leaves the battlefield, clear the
    // pairing on both halves (the partner stays on the battlefield but
    // is now unpaired).
    const ltbId = game.newEntityId();
    const ltb: TriggeredAbilityWithResolver = {
      id: ltbId,
      kind: "triggered",
      sourceCardId,
      activeInZones: new Set([ZoneType.Battlefield]),
      timestamp: 0,
      controllerSeatAtReg: controllerSeat,
      isDelayed: false,
      matches(event: GameEvent): boolean {
        if (event.kind !== "CardChangedZone") return false;
        const p = event.payload as { cardId: EntityId; fromZone: ZoneType; toZone: ZoneType };
        return (
          p.cardId === sourceCardId &&
          p.fromZone === ZoneType.Battlefield &&
          p.toZone !== ZoneType.Battlefield
        );
      },
      resolver: {
        *resolve(gameUnknown: unknown): Generator<unknown, void, unknown> {
          const g = gameUnknown as Game;
          const self = g.cards.get(sourceCardId);
          if (!self) {
            // No-op yield* over an empty array keeps the generator shape
            // uniform with peer handlers and satisfies biome's useYield
            // rule even when the cleanup path emits no engine event.
            yield* [] as readonly never[];
            return;
          }
          const partnerId = self.pairedWith;
          if (partnerId === undefined) {
            yield* [] as readonly never[];
            return;
          }
          self.pairedWith = undefined;
          const partner = g.cards.get(partnerId);
          if (partner && partner.pairedWith === sourceCardId) {
            partner.pairedWith = undefined;
          }
          yield* [] as readonly never[];
        },
      },
    };
    card.triggeredAbilities.push(ltb as unknown as TriggeredAbility);
    game.triggerRegistry.register(ltb as unknown as TriggeredAbility);
  }

  override deactivate(_ast: KeywordAst, ctx: KeywordActivationContext): void {
    const card = ctx.game.cards.get(ctx.sourceCardId);
    card?.keywords?.delete("soulbond");
  }
}

keywordHandlerRegistry.register(SoulbondKeywordHandler);
