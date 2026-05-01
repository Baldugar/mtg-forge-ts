// SPDX-License-Identifier: GPL-3.0-or-later
// EnlistKeywordHandler — processes K:Enlist keyword lines (Dominaria
// United, CR 702.163) and synthesizes an attacks-trigger that yields a
// chooseCard for an untapped Creature.YouCtrl, taps it, and pumps the
// attacker by its power UEoT.
//
// CR 702.163a — "Enlist" — "When this creature attacks, you may tap a
// nonattacking creature you control without summoning sickness. When you
// do, add its power to this creature's power until end of turn."
//
// Wave 79 scope:
//   1. Adds "enlist" to card.keywords.
//   2. Stamps `card.enlist = true`.
//   3. Synthesizes one TriggeredAbility watching `AttackersDeclared`
//      whose attackers list contains self. resolve() yields a
//      chooseCard (min=0, max=1) over the controller's untapped non-
//      attacking creatures (excluding self), taps the chosen creature,
//      and registers a Layer 7c +N/+0 effect on self UEoT (where N is
//      the chosen creature's power at the time of choice).
import type {
  ContinuousEffect,
  EffectDuration,
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

export class EnlistKeywordHandler extends KeywordHandler {
  static override readonly keyword = "enlist" as const;

  override activate(_ast: KeywordAst, ctx: KeywordActivationContext): void {
    const card = ctx.game.cards.get(ctx.sourceCardId);
    if (!card) return;
    if (!card.keywords) card.keywords = new Set();
    card.keywords.add("enlist");
    card.enlist = true;

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
        return p.attackers.some((a) => a.attackerId === sourceCardId);
      },
      resolver: {
        *resolve(gameUnknown: unknown): Generator<unknown, void, unknown> {
          const g = gameUnknown as Game;
          const self = g.cards.get(sourceCardId);
          if (!self) return;

          // Enumerate eligible enlistees: controller's untapped, non-
          // attacking creatures on the battlefield (excluding self).
          const eligible: EntityId[] = [];
          for (const [id, c] of g.cards) {
            if (id === sourceCardId) continue;
            if (c.zone !== ZoneType.Battlefield) continue;
            if (c.controllerSeat !== controllerSeat) continue;
            if (c.tapped === true) continue;
            // CR 702.163a — "tap a nonattacking creature". Use the
            // combat-flag stamped by declareAttackers (Wave 65.A). The
            // enlist trigger fires on AttackersDeclared, so attackers
            // already have `attackedThisCombat = true` at this point.
            if (c.attackedThisCombat === true) continue;
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
              restriction: { keyword: "enlist" },
              min: 0,
              max: 1,
            },
          }) as { readonly kind: "chooseCard"; readonly chosen: readonly EntityId[] } | undefined;
          if (!decision || decision.kind !== "chooseCard") return;
          const chosenId = decision.chosen[0];
          if (chosenId === undefined) return;
          if (!eligible.includes(chosenId)) return;

          // Snapshot the chosen creature's power BEFORE tapping (the
          // text says "add its power" — power is read at the tap-time
          // moment per CR 702.163a).
          const chosenChars = g.layerEngine.computeCharacteristics(chosenId);
          const power = chosenChars.power ?? 0;

          // Tap the enlistee.
          yield* g.action.tap(chosenId);

          // Register a Layer 7c +power/+0 boost on self UEoT. Scope the
          // effect to self via `targetCardIdFn` so the modifier applies
          // only to this attacker, not every creature.
          if (power !== 0) {
            const timestamp: number = g.newEntityId();
            const layer7c: Layer7cEffect = {
              kind: "modify",
              powerDelta: power,
              toughnessDelta: 0,
              timestamp,
              sourceAbilityId: sourceCardId,
              targetCardIdFn: () => sourceCardId,
            };
            const duration: EffectDuration = { kind: "untilEndOfTurn" };
            const effect: ContinuousEffect = {
              id: g.newEntityId(),
              sourceCardId,
              timestamp,
              layer: Layer.L7c_PTModify,
              duration,
              payload: { kind: "pt-modify", effect: layer7c },
            };
            g.continuousEffectRegistry.register(effect);
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
    if (!card) return;
    card.keywords?.delete("enlist");
    card.enlist = undefined;
  }
}

keywordHandlerRegistry.register(EnlistKeywordHandler);
