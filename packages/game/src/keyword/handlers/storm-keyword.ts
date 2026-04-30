// SPDX-License-Identifier: GPL-3.0-or-later
// StormKeywordHandler — processes K:Storm keyword lines (Scourge,
// CR 702.40) and synthesizes a SpellCast(Card.Self) trigger that copies
// the spell once for each OTHER spell cast this turn before it.
//
// CR 702.40a — "When you cast this spell, copy it for each other spell
// that was cast before it this turn. You may choose new targets for the
// copies."
//
// DSL form:
//   K:Storm
//
// This handler:
//   1. Adds "storm" to card.keywords.
//   2. Builds a TriggeredAbility whose matcher fires on SpellCast where
//      cardId === self.
//   3. Resolver reads `game.flags.spellsCastThisTurn[seat]` AT FIRE-TIME.
//      Because cast-pipeline calls `noteSpellCast` AFTER the SpellCast
//      event emits, the storm spell itself is already counted in the
//      figure we read. We compute `count - 1` to get "other spells before
//      this one" (CR 702.40a wording).
//   4. Push that many copies on the stack via Stack.copy.
//
// MVP scope:
//   - Targets are inherited verbatim from the original (Stack.copy default).
//     CR 702.40a allows new targets per copy; threading a re-target decision
//     is deferred (mirrors Conspire's MVP simplification).
import type { EntityId, GameEvent, KeywordAst, PlayerSeat, TriggeredAbility } from "@mtg-forge-ts/core";
import { ZoneType } from "@mtg-forge-ts/core";
import type { Game } from "../../game.js";
import type { StackItemResolver } from "../../stack/stack-item.js";
import { cantBeCopied } from "../../statics/wave70m-gate-helpers.js";
import { keywordHandlerRegistry } from "../keyword-handler-registry.js";
import type { KeywordActivationContext } from "../keyword-handler.js";
import { KeywordHandler } from "../keyword-handler.js";

type TriggeredAbilityWithResolver = TriggeredAbility & {
  readonly resolver: StackItemResolver | null;
};

export class StormKeywordHandler extends KeywordHandler {
  static override readonly keyword = "storm" as const;

  override activate(_ast: KeywordAst, ctx: KeywordActivationContext): void {
    const card = ctx.game.cards.get(ctx.sourceCardId);
    if (!card) return;

    if (!card.keywords) card.keywords = new Set();
    card.keywords.add("storm");

    const sourceCardId = ctx.sourceCardId;
    const controllerSeat = ctx.controllerSeat;
    const game = ctx.game;
    const triggerId = game.newEntityId();

    const ta: TriggeredAbilityWithResolver = {
      id: triggerId,
      kind: "triggered",
      sourceCardId,
      // Storm is on the spell itself; SpellCast emits with the item already
      // pushed onto the stack — like Cascade, the trigger is active in Stack.
      activeInZones: new Set([ZoneType.Stack]),
      timestamp: 0,
      controllerSeatAtReg: controllerSeat,
      isDelayed: false,
      matches(event: GameEvent): boolean {
        if (event.kind !== "SpellCast") return false;
        const p = event.payload as { readonly cardId: EntityId; readonly stackItemId: EntityId };
        return p.cardId === sourceCardId;
      },
      resolver: {
        // biome-ignore lint/correctness/useYield: storm copies synchronously via Stack.copy
        *resolve(gameUnknown: unknown): Generator<unknown, void, unknown> {
          const g = gameUnknown as Game;
          // Read the live counter. Because cast-pipeline calls
          // noteSpellCast AFTER SpellCast emits, this storm spell is
          // already counted; subtract 1 for the "other spells before"
          // count required by CR 702.40a.
          const seat: PlayerSeat = controllerSeat;
          const live = g.flags.spellsCastThisTurn.get(seat) ?? 0;
          const otherCount = Math.max(0, live - 1);
          if (otherCount === 0) return;

          // Find the storm spell's stack item to copy. Storm.matches fired
          // on SpellCast which emits AFTER stack push, so the source spell
          // is on the stack right now.
          const stack = g.sharedZones.stack;
          let sourceItemId: EntityId | null = null;
          for (const it of stack.toArray()) {
            if (it.kind === "spell" && it.sourceCardId === sourceCardId) {
              sourceItemId = it.id;
            }
          }
          if (sourceItemId === null) return;

          // Wave 70.M — silent CantBeCopied gate. When any active static
          // matches this storm spell's underlying card, suppress all
          // copies (Display of Power / See Double — "this spell can't be
          // copied"). Resolved once outside the loop since the gate
          // doesn't change between iterations.
          if (cantBeCopied(g, sourceCardId)) return;

          for (let i = 0; i < otherCount; i++) {
            stack.copy(sourceItemId, controllerSeat, g);
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
    card?.keywords?.delete("storm");
  }
}

keywordHandlerRegistry.register(StormKeywordHandler);
