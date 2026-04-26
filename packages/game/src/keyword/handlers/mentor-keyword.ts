// SPDX-License-Identifier: GPL-3.0-or-later
// MentorKeywordHandler — processes K:Mentor keyword lines (Ravnica
// Allegiance; CR 702.133) and synthesizes an "attacks" TriggeredAbility
// on the creature.
//
// CR 702.133a — "Mentor": "Whenever this creature attacks, choose
// another attacking creature with lesser power. Put a +1/+1 counter on
// it." MVP scope:
//   1. Add "mentor" to card.keywords.
//   2. Watch CombatAttackerDeclared (or AttackerDeclared) events for
//      this card.
//   3. On resolve: enumerate other attacking creatures the controller
//      controls with computed power < self.power; if at least one,
//      yield chooseCard for one and addCounter(+1/+1, 1) on it.
//
// MVP simplification: the trigger fires off the attacker-declaration
// event family. The "lesser power" check is read at resolution time
// via the layer engine. If no eligible target exists, the resolver
// no-ops (matches Forge: target is "may", but if eligible set is empty
// the ability fizzles silently).
import type { EntityId, GameEvent, KeywordAst, TriggeredAbility } from "@mtg-forge-ts/core";
import { CardType, CounterType, ZoneType } from "@mtg-forge-ts/core";
import type { Game } from "../../game.js";
import type { StackItemResolver } from "../../stack/stack-item.js";
import { keywordHandlerRegistry } from "../keyword-handler-registry.js";
import type { KeywordActivationContext } from "../keyword-handler.js";
import { KeywordHandler } from "../keyword-handler.js";

type TriggeredAbilityWithResolver = TriggeredAbility & {
  readonly resolver: StackItemResolver | null;
};

const finite = (n: number | null | undefined): number => {
  if (n === null || n === undefined) return 0;
  return Number.isFinite(n) ? n : 0;
};

export class MentorKeywordHandler extends KeywordHandler {
  static override readonly keyword = "mentor" as const;

  override activate(_ast: KeywordAst, ctx: KeywordActivationContext): void {
    const card = ctx.game.cards.get(ctx.sourceCardId);
    if (!card) return;

    if (!card.keywords) card.keywords = new Set();
    card.keywords.add("mentor");

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
        // CR 702.133a — "whenever this creature attacks". The engine
        // emits AttackerDeclared (per-attacker) when the attacker set
        // resolves. Match only events whose sourceId / attackerId is
        // self.
        if (event.kind !== "AttackerDeclared") return false;
        const p = event.payload as { attackerId?: EntityId };
        return p.attackerId === sourceCardId;
      },

      resolver: {
        *resolve(gameUnknown: unknown): Generator<unknown, void, unknown> {
          const g = gameUnknown as Game;
          const self = g.cards.get(sourceCardId);
          if (!self) return;
          const selfChars = g.layerEngine.computeCharacteristics(sourceCardId);
          const selfPower = finite(selfChars.power);

          // Enumerate eligible targets: other attacking creatures the
          // controller controls with lesser power. The "attacking" set
          // lives on game.combat — MVP fallback: any creature on the
          // controller's battlefield with `attacking === true`. If the
          // engine doesn't yet track per-creature attacking flags here,
          // we fall back to "any creature with lesser power" as a soft
          // approximation; the precise filter lands once the combat
          // layer exposes a public attacking-set API.
          const eligible: EntityId[] = [];
          for (const [id, c] of g.cards) {
            if (id === sourceCardId) continue;
            if (c.controllerSeat !== controllerSeat) continue;
            if (c.zone !== ZoneType.Battlefield) continue;
            const chars = g.layerEngine.computeCharacteristics(id);
            if (!chars.types.has(CardType.Creature)) continue;
            // Soft filter — attacking flag on Card if available.
            if ((c as { attacking?: boolean }).attacking !== true) continue;
            if (finite(chars.power) >= selfPower) continue;
            eligible.push(id);
          }
          if (eligible.length === 0) return;

          // MVP auto-pick: take the first eligible. The full
          // chooseCard decision is yielded once the decision schema for
          // mentor is registered with the decision engine.
          const target = eligible[0];
          if (target === undefined) return;
          yield* g.action.addCounter(target, CounterType.PlusOnePlusOne, 1, sourceCardId);
        },
      },
    };

    if (!card.triggeredAbilities) card.triggeredAbilities = [];
    card.triggeredAbilities.push(ta as unknown as TriggeredAbility);
    game.triggerRegistry.register(ta as unknown as TriggeredAbility);
  }

  override deactivate(_ast: KeywordAst, ctx: KeywordActivationContext): void {
    const card = ctx.game.cards.get(ctx.sourceCardId);
    card?.keywords?.delete("mentor");
  }
}

keywordHandlerRegistry.register(MentorKeywordHandler);
