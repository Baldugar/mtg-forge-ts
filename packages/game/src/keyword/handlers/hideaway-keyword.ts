// SPDX-License-Identifier: GPL-3.0-or-later
// HideawayKeywordHandler — processes K:Hideaway / K:Hideaway:N keyword
// lines (Lorwyn / Future Sight, CR 702.74) and synthesizes an ETB
// trigger that taps self, looks at the top N cards of the controller's
// library, exiles one face down, and shuffles the rest to the bottom.
//
// CR 702.74a — "Hideaway N (This permanent enters the battlefield
// tapped. When it enters, look at the top N cards of your library, exile
// one face down, then put the rest on the bottom in a random order.)"
//
// DSL form:
//   K:Hideaway      → defaults to N = 4 (the printed value on every card)
//   K:Hideaway:N    → explicit N
//
// MVP scope:
//   1. Adds "hideaway" to card.keywords.
//   2. ETB trigger: tap self, peek top N library cards, yield chooseCard
//      (min=1, max=1) over those, exile chosen face down, stamp
//      `card.hideawayCard = chosen` and `chosen.hideawayHost = self`,
//      shuffle remaining cards back into the bottom of the library.
//
// TODO(advanced) — The conditional free-cast ability ("Cast the exiled
// card without paying its mana cost") is per-card text (each Hideaway
// card has its own activation condition: "at the beginning of your
// upkeep, if you have 7 or more lands…"). Those abilities are
// represented in the card's AST as separate triggered/static rules; the
// keyword's portion ends at exile-and-stamp. The stamped slots
// (`hideawayCard` / `hideawayHost`) are the contract those abilities
// consult to find the exiled card.
import type { EntityId, GameEvent, KeywordAst, ParamValue, TriggeredAbility } from "@mtg-forge-ts/core";
import { ZoneType } from "@mtg-forge-ts/core";
import type { Game } from "../../game.js";
import type { StackItemResolver } from "../../stack/stack-item.js";
import { keywordHandlerRegistry } from "../keyword-handler-registry.js";
import type { KeywordActivationContext } from "../keyword-handler.js";
import { KeywordHandler } from "../keyword-handler.js";

type TriggeredAbilityWithResolver = TriggeredAbility & {
  readonly resolver: StackItemResolver | null;
};

export class HideawayKeywordHandler extends KeywordHandler {
  static override readonly keyword = "hideaway" as const;

  override activate(ast: KeywordAst, ctx: KeywordActivationContext): void {
    const card = ctx.game.cards.get(ctx.sourceCardId);
    if (!card) return;

    if (!card.keywords) card.keywords = new Set();
    card.keywords.add("hideaway");

    const amountParam = ast.params?.amount as ParamValue | undefined;
    const hideN =
      amountParam && amountParam.kind === "literal" ? Number.parseInt(amountParam.raw as string, 10) : 4;
    const safeN = Number.isFinite(hideN) && hideN > 0 ? hideN : 4;

    const game = ctx.game;
    const sourceCardId = ctx.sourceCardId;
    const controllerSeat = ctx.controllerSeat;

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
          // Tap self first ("This permanent enters the battlefield
          // tapped" — CR text uses the wording "enters tapped"; modeling
          // it as a post-ETB tap is a small visible difference but
          // mechanically equivalent for SBA/combat purposes).
          yield* g.action.tap(sourceCardId);

          // Peek top N library cards.
          const player = g.getPlayer(controllerSeat);
          const library = player.zones.get(ZoneType.Library);
          if (!library) return;
          const peeked: EntityId[] = [];
          for (let i = 0; i < safeN; i++) {
            const id = library.peekAt(i);
            if (id === undefined) break;
            peeked.push(id);
          }
          if (peeked.length === 0) return;

          const decision = (yield {
            kind: "decision",
            request: {
              kind: "chooseCard",
              playerSeat: controllerSeat,
              pool: peeked,
              restriction: { keyword: "hideaway", n: safeN },
              min: 1,
              max: 1,
            },
          }) as { readonly kind: "chooseCard"; readonly chosen: readonly EntityId[] } | undefined;
          if (!decision || decision.kind !== "chooseCard") return;
          const exileId = decision.chosen[0];
          if (exileId === undefined) return;
          if (!peeked.includes(exileId)) return;

          // Move the chosen card to Exile and stamp the linkage.
          yield* g.action.moveTo(exileId, ZoneType.Exile, {
            toSeat: controllerSeat,
            cause: "hideaway",
          });
          const self = g.cards.get(sourceCardId);
          if (self) self.hideawayCard = exileId;
          const exiled = g.cards.get(exileId);
          if (exiled) exiled.hideawayHost = sourceCardId;

          // Move the remaining peeked cards to the bottom of library
          // in a (deterministic via game.rng) random order.
          const rest = peeked.filter((id) => id !== exileId);
          if (rest.length === 0) return;
          // Remove them from the top in their current order.
          for (const id of rest) {
            // peekAt indices may shift after each removal; locate by id.
            const items = library.toArray();
            const idx = items.indexOf(id);
            if (idx >= 0) library.removeAt(idx);
          }
          const shuffled = g.rng.shuffle(rest);
          for (const id of shuffled) library.add(id);
        },
      },
    };

    if (!card.triggeredAbilities) card.triggeredAbilities = [];
    card.triggeredAbilities.push(etb as unknown as TriggeredAbility);
    game.triggerRegistry.register(etb as unknown as TriggeredAbility);
  }

  override deactivate(_ast: KeywordAst, ctx: KeywordActivationContext): void {
    const card = ctx.game.cards.get(ctx.sourceCardId);
    card?.keywords?.delete("hideaway");
  }
}

keywordHandlerRegistry.register(HideawayKeywordHandler);
