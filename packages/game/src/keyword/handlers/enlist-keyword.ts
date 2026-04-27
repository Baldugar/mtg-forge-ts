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
// MVP scope:
//   1. Adds "enlist" to card.keywords.
//   2. Stamps `card.enlist = true`.
//   3. Synthesizes one TriggeredAbility watching `AttackersDeclared`
//      whose attackers list contains self. The chooseCard / tap / pump
//      resolution is documented under TODO(advanced); the trigger
//      registration captures the durable contract.
import type { EntityId, GameEvent, KeywordAst, PlayerSeat, TriggeredAbility } from "@mtg-forge-ts/core";
import { ZoneType } from "@mtg-forge-ts/core";
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
        // biome-ignore lint/correctness/useYield: MVP no-op until chooseCard + tap + pump lands
        *resolve(): Generator<unknown, void, unknown> {
          // TODO(advanced) — chooseCard from controller's untapped non-
          // attacking creatures; tap chosen; addPump +power/+0 UEoT.
          return;
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
