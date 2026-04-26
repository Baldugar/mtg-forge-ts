// SPDX-License-Identifier: GPL-3.0-or-later
// CascadeKeywordHandler — processes K:Cascade and synthesizes a TRIGGERED
// ability that fires when the source card is cast (CR 702.85).
//
// Forge K:Cascade has no parameters: `K:Cascade` parses as
//   { keyword: "cascade", params: undefined }.
//
// On activation:
//   1. Adds "cascade" to card.keywords (flag awareness for other systems).
//   2. Builds a TriggeredAbility that matches a SpellCast event whose
//      cardId equals the source card. (Cascade is the canonical exception
//      to "Card.Self" — the trigger lives on the spell itself and fires
//      when that spell is cast; activeInZones therefore includes Stack.)
//   3. Registers the trigger with game.triggerRegistry.
//
// Resolver (CR 702.85a):
//   Exile cards from the top of the casting player's library until a non-
//   land card with mana value LESS than the source spell's mana value is
//   exiled. The casting player MAY cast that card without paying its mana
//   cost. Then put all the other exiled cards on the bottom of their
//   library in a random order.
//
// MVP scope:
//   - Casting player == cascade source's controller.
//   - "Mana value less than the spell's" uses ManaCost.cmc(0); X is treated
//     as 0 here (cascade compares against the spell's printed cost in the
//     usual case). Future refinement when cascade interacts with X spells
//     can read the cast item's xValue.
//   - The "may cast for free" decision is yielded as a confirmAction request
//     (yes/no). When confirmed, a FreeCastPipeline (the same subclass used by
//     Play$ WithoutManaCost$) runs the cast from Exile.
//   - Bottom-of-library ordering uses game.rng (SeededRng) Fisher-Yates so
//     the shuffle is deterministic for a given seed.
import type {
  EntityId,
  GameEvent,
  KeywordAst,
  PaperCard,
  PlayerSeat,
  TriggeredAbility,
} from "@mtg-forge-ts/core";
import { CardType, ManaCost, ZoneType } from "@mtg-forge-ts/core";
import type { ManaCostAst } from "@mtg-forge-ts/core";
import type { EngineYield } from "../../action/engine-yield.js";
import type { CastContext } from "../../cast/cast-context.js";
import { CastPipeline, type CastProposal } from "../../cast/cast-pipeline.js";
import type { Game } from "../../game.js";
import type { StackItemResolver } from "../../stack/stack-item.js";
import { keywordHandlerRegistry } from "../keyword-handler-registry.js";
import type { KeywordActivationContext } from "../keyword-handler.js";
import { KeywordHandler } from "../keyword-handler.js";

// TriggeredAbility extended with the StackItemResolver the priority/resolve
// orchestrator duck-types. Core's TriggeredAbility doesn't carry the
// resolver field directly (it's a game-layer concept) so we extend locally
// and cast to TriggeredAbility on register.
type TriggeredAbilityWithResolver = TriggeredAbility & {
  readonly resolver: StackItemResolver | null;
};

/**
 * FreeCastPipeline mirror — sets ctx.totalCost.base to null so stepPayCosts
 * auto-passes (existing free-cast gate). Same shape as the local copy in
 * ability/effects/play.ts; we duplicate rather than export from there to
 * avoid a keyword→effect import (effects already import from cast/, and
 * pulling play.ts into the keyword bootstrap path widens the registration
 * surface unnecessarily).
 */
class FreeCastPipeline extends CastPipeline {
  protected override *stepDetermineTotalCost(ctx: CastContext): Generator<EngineYield, void, unknown> {
    const costMods = this.game.staticEffectRegistry.byCategory("costModification");
    ctx.totalCost = {
      base: null,
      modIds: costMods.map((s) => s.id),
      additionalCostIds: [...ctx.additionalCostsPaid],
      altCostUsed: ctx.altCostUsed,
      xValue: ctx.xValue,
    };
  }
}

/** Pull the printed mana value off a card's PaperCard definition.
 * `def.manaCost` is a ManaCostAst carrying the raw "{1}{R}{B}"-shaped text;
 * parse it into a ManaCost on demand and read its CMC. Mirrors the parsing
 * done in `layers/base-characteristics.ts`. */
const cardManaValue = (paper: PaperCard | undefined): number => {
  const def = paper?.definition;
  if (!def) return 0;
  const mcAst = def.manaCost as ManaCostAst | null | undefined;
  if (!mcAst) return 0;
  const mc = ManaCost.parse(mcAst.raw);
  return mc.cmc(0);
};

/** True when the card's PaperCard definition has the Land card type. */
const isLand = (paper: PaperCard | undefined): boolean => {
  const def = paper?.definition;
  if (!def) return false;
  return def.types.has(CardType.Land);
};

export class CascadeKeywordHandler extends KeywordHandler {
  static override readonly keyword = "cascade" as const;

  override activate(ast: KeywordAst, ctx: KeywordActivationContext): void {
    void ast; // K:Cascade carries no params
    const card = ctx.game.cards.get(ctx.sourceCardId);
    if (!card) return;

    // 1. Flag the keyword.
    if (!card.keywords) card.keywords = new Set();
    card.keywords.add("cascade");

    // 2. Build a triggered ability that fires on SpellCast(Card.Self).
    const sourceCardId = ctx.sourceCardId;
    const controllerSeat = ctx.controllerSeat;
    const triggerId = ctx.game.newEntityId();

    const ta: TriggeredAbilityWithResolver = {
      id: triggerId,
      kind: "triggered",
      sourceCardId,
      // Cascade fires while the spell is on the stack — the SpellCast event
      // is emitted right after the StackItem is pushed (cast-pipeline.ts
      // L161-178). Triggers active on Stack are eligible at fire time.
      activeInZones: new Set([ZoneType.Stack]),
      timestamp: 0,
      controllerSeatAtReg: controllerSeat,
      isDelayed: false,

      matches(event: GameEvent): boolean {
        if (event.kind !== "SpellCast") return false;
        const payload = event.payload as {
          readonly cardId: EntityId;
          readonly controllerSeat: PlayerSeat;
        };
        return payload.cardId === sourceCardId;
      },

      resolver: {
        *resolve(gameUnknown: unknown): Generator<unknown, void, unknown> {
          const game = gameUnknown as Game;
          const sourceCard = game.cards.get(sourceCardId);
          if (!sourceCard) return;
          const player = game.getPlayer(controllerSeat);
          const library = player.zones.get(ZoneType.Library);
          if (!library) return;

          const spellMv = cardManaValue(sourceCard.paperCard);

          // Exile cards from the top of the library one at a time until a
          // non-land card with mana value < spellMv is exiled, or the
          // library is empty.
          const exiledIds: EntityId[] = [];
          let foundCardId: EntityId | null = null;
          while (library.size > 0) {
            const topId = library.peekAt(0);
            if (topId === undefined) break;
            yield* game.action.moveTo(topId, ZoneType.Exile);
            exiledIds.push(topId);
            const exiled = game.cards.get(topId);
            if (!exiled) continue;
            if (isLand(exiled.paperCard)) continue;
            const cardMv = cardManaValue(exiled.paperCard);
            if (cardMv < spellMv) {
              foundCardId = topId;
              break;
            }
          }

          // CR 702.85a — the casting player MAY cast the found card
          // without paying its mana cost. Yield a confirmAction to ask.
          if (foundCardId !== null) {
            const response = (yield {
              kind: "decision",
              request: {
                kind: "confirmAction",
                sourceId: sourceCardId,
                prompt: "Cast the cascaded card without paying its mana cost?",
              },
            }) as { readonly kind: "confirmAction"; readonly confirmed: boolean } | undefined;
            const confirmed = response?.confirmed === true;

            if (confirmed) {
              const pipeline = new FreeCastPipeline(game);
              const proposal: CastProposal = {
                castingPlayer: controllerSeat,
                sourceCardId: foundCardId,
                originZone: ZoneType.Exile,
                asSpecialAction: false,
              };
              yield* pipeline.run(proposal) as Generator<unknown, unknown, unknown>;
              // The cascaded card is no longer in Exile — strip it from
              // the bottom-shuffle list so we don't try to move it again.
              const idx = exiledIds.indexOf(foundCardId);
              if (idx >= 0) exiledIds.splice(idx, 1);
            }
          }

          // Bottom-of-library shuffle — Fisher-Yates over the surviving
          // exiled ids using game.rng (deterministic per seed).
          for (let i = exiledIds.length - 1; i > 0; i--) {
            const j = game.rng.nextInt(0, i + 1);
            const tmp = exiledIds[i] as EntityId;
            exiledIds[i] = exiledIds[j] as EntityId;
            exiledIds[j] = tmp;
          }
          // Move each one to the library. Zone.add defaults to appending at
          // the bottom (items.length), which matches the "bottom of library"
          // semantics in CR 702.85a.
          for (const id of exiledIds) {
            yield* game.action.moveTo(id, ZoneType.Library);
          }
        },
      },
    };

    ctx.game.triggerRegistry.register(ta as unknown as TriggeredAbility);
  }

  override deactivate(ast: KeywordAst, ctx: KeywordActivationContext): void {
    void ast;
    const card = ctx.game.cards.get(ctx.sourceCardId);
    if (!card) return;
    card.keywords?.delete("cascade");
    // The trigger registration is keyed by (sourceCardId); zone-activation
    // and the registry's per-card unregister hooks clean it up when the
    // card leaves the stack. SP4 may add explicit per-keyword unregister
    // bookkeeping mirrored on cycling-keyword's cleanup TODO.
  }
}

keywordHandlerRegistry.register(CascadeKeywordHandler);
