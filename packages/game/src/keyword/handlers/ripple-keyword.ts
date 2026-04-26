// SPDX-License-Identifier: GPL-3.0-or-later
// RippleKeywordHandler — processes K:Ripple:N keyword lines (Coldsnap,
// CR 702.79) and synthesizes a SpellCast(Card.Self) trigger that reveals
// the top N cards of the controller's library and offers to free-cast
// any same-named cards.
//
// CR 702.79a — "Ripple N" — "When you cast this spell, you may reveal
// the top N cards of your library. You may cast spells with the same
// name as this spell from among them without paying their mana costs.
// Then put the rest on the bottom of your library in any order."
//
// DSL form:
//   K:Ripple:4   → N = 4
//
// MVP scope:
//   1. Adds "ripple" to card.keywords.
//   2. Synthesizes a SpellCast self-trigger that yields a confirmAction
//      ("reveal top N?"); on confirm, yields a CardsRevealed event for
//      the top N then moves them to the bottom of the library. The
//      free-cast leg of the same-name cards is deferred (TODO advanced).
//
// TODO(advanced) — Casting the same-named cards without paying their
// mana cost is the same plumbing as Cascade's free-cast (see
// Cascade's FreeCastPipeline subclass). Wave 39 stamps the trigger and
// the reveal; the free-cast loop lands when the per-card iterative free-
// cast pipeline is widened to non-cascade callers.
import type { EntityId, GameEvent, KeywordAst, ParamValue, TriggeredAbility } from "@mtg-forge-ts/core";
import { ZoneType, mkEvent } from "@mtg-forge-ts/core";
import type { Game } from "../../game.js";
import type { StackItemResolver } from "../../stack/stack-item.js";
import { keywordHandlerRegistry } from "../keyword-handler-registry.js";
import type { KeywordActivationContext } from "../keyword-handler.js";
import { KeywordHandler } from "../keyword-handler.js";

type TriggeredAbilityWithResolver = TriggeredAbility & {
  readonly resolver: StackItemResolver | null;
};

export class RippleKeywordHandler extends KeywordHandler {
  static override readonly keyword = "ripple" as const;

  override activate(ast: KeywordAst, ctx: KeywordActivationContext): void {
    const card = ctx.game.cards.get(ctx.sourceCardId);
    if (!card) return;

    if (!card.keywords) card.keywords = new Set();
    card.keywords.add("ripple");

    const amountParam = ast.params?.amount as ParamValue | undefined;
    const rawN =
      amountParam && amountParam.kind === "literal" ? Number.parseInt(amountParam.raw as string, 10) : 4;
    const n = Number.isFinite(rawN) && rawN > 0 ? rawN : 4;

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
        const p = event.payload as { readonly cardId: EntityId };
        return p.cardId === sourceCardId;
      },

      resolver: {
        *resolve(gameUnknown: unknown): Generator<unknown, void, unknown> {
          const g = gameUnknown as Game;

          // 1. Confirm: do you want to reveal the top N?
          const decision = yield {
            kind: "decision",
            request: {
              kind: "confirmAction",
              sourceId: sourceCardId,
              prompt: `Reveal the top ${n} cards of your library for Ripple?`,
            },
          };
          const r = decision as { kind: string; confirmed?: boolean };
          if (r.kind !== "confirmAction" || r.confirmed !== true) return;

          // 2. Read the controller's library + take the top N.
          const player = g.players.find((p) => p.seat === controllerSeat);
          if (!player) return;
          const library = player.zones.get(ZoneType.Library);
          if (!library) return;
          const sliceLen = Math.min(n, library.toArray().length);
          if (sliceLen === 0) return;
          const revealedIds: EntityId[] = [];
          for (let i = 0; i < sliceLen; i++) {
            const top = library.peekAt(0);
            if (top === undefined) break;
            library.removeAt(0);
            revealedIds.push(top);
          }
          if (revealedIds.length === 0) return;

          yield {
            kind: "event",
            event: mkEvent("CardsRevealed", g.turn, g.phase, {
              revealedBy: controllerSeat,
              revealedTo: "all" as const,
              cardIds: revealedIds,
              fromZone: ZoneType.Library,
            }),
          };

          // 3. TODO(advanced) — for each revealed card with same name as
          // self, yield a confirmAction → free-cast via FreeCastPipeline.
          // Wave 39 leaves the matched cards in declared order on bottom;
          // the free-cast leg lands when the iterative free-cast pipeline
          // is widened to non-cascade callers.

          // 4. Place the revealed slice at the bottom of the library in
          // declared order. (CR 702.79: "in any order" — MVP keeps order.)
          for (const id of revealedIds) {
            library.add(id);
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
    card?.keywords?.delete("ripple");
  }
}

keywordHandlerRegistry.register(RippleKeywordHandler);
