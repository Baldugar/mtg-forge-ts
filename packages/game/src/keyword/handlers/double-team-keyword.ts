// SPDX-License-Identifier: GPL-3.0-or-later
// DoubleTeamKeywordHandler — processes K:Double team keyword lines
// (Streets of New Capenna / Lost Caverns of Ixalan, CR 702.165) and
// synthesizes a SpellCast self-trigger that flags `doubleTeamCopyRequested`
// so the cast pipeline can copy the spell into the controller's starting
// deck (sideboard) on resolution.
//
// CR 702.165a — "Double team" — "When you cast this spell from your hand,
// if it doesn't have double team, conjure a duplicate of it into your
// sideboard. The duplicate has double team."
//
// MVP scope:
//   1. Adds "double_team" to card.keywords.
//   2. Stamps `card.doubleTeam = true`.
//   3. Synthesizes a SpellCast self-trigger watching SpellCast events
//      whose sourceCardId === self. On resolve: stamp
//      card.doubleTeamCopyRequested = true. The actual sideboard copy
//      machinery is documented under TODO(advanced).
import type { EntityId, GameEvent, KeywordAst, TriggeredAbility } from "@mtg-forge-ts/core";
import { ZoneType } from "@mtg-forge-ts/core";
import type { Game } from "../../game.js";
import type { StackItemResolver } from "../../stack/stack-item.js";
import { keywordHandlerRegistry } from "../keyword-handler-registry.js";
import type { KeywordActivationContext } from "../keyword-handler.js";
import { KeywordHandler } from "../keyword-handler.js";

type TriggeredAbilityWithResolver = TriggeredAbility & {
  readonly resolver: StackItemResolver | null;
};

export class DoubleTeamKeywordHandler extends KeywordHandler {
  static override readonly keyword = "double_team" as const;

  override activate(_ast: KeywordAst, ctx: KeywordActivationContext): void {
    const card = ctx.game.cards.get(ctx.sourceCardId);
    if (!card) return;
    if (!card.keywords) card.keywords = new Set();
    card.keywords.add("double_team");
    card.doubleTeam = true;

    const game = ctx.game;
    const sourceCardId = ctx.sourceCardId;
    const controllerSeat = ctx.controllerSeat;
    const triggerId = game.newEntityId();

    const ta: TriggeredAbilityWithResolver = {
      id: triggerId,
      kind: "triggered",
      sourceCardId,
      activeInZones: new Set([ZoneType.Stack]),
      timestamp: 0,
      controllerSeatAtReg: controllerSeat,
      isDelayed: false,
      matches(event: GameEvent): boolean {
        if (event.kind !== "SpellCast") return false;
        const p = event.payload as { cardId: EntityId };
        return p.cardId === sourceCardId;
      },
      resolver: {
        // biome-ignore lint/correctness/useYield: stamp is synchronous
        *resolve(gameUnknown: unknown): Generator<unknown, void, unknown> {
          const g = gameUnknown as Game;
          const self = g.cards.get(sourceCardId);
          if (!self) return;
          self.doubleTeamCopyRequested = true;
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
    card.keywords?.delete("double_team");
    card.doubleTeam = undefined;
    card.doubleTeamCopyRequested = undefined;
  }
}

keywordHandlerRegistry.register(DoubleTeamKeywordHandler);
