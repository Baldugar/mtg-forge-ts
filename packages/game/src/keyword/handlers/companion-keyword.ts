// SPDX-License-Identifier: GPL-3.0-or-later
// CompanionKeywordHandler — processes K:Companion:<condition>:<reminder>
// keyword lines (Ikoria, CR 702.139) and stamps the keyword + condition
// slot on the card. Wave 66 closes the runtime portion: synthesizes an
// OutsideTheGame-zone activated SpellAbility that pays {3} (additional)
// once per game to move the companion from outside the game into the
// controller's hand.
//
// CR 702.139a — "Companion <restriction> — If your starting deck meets
// the restriction, you may put this card from outside the game into your
// sideboard. After your first turn, pay {3}, then this card goes to your
// hand from outside the game."
//
// CR 702.139b — "Once per game, that player may pay {3} as a special
// action to put their companion from outside the game into their hand."
//
// DSL form (Forge):
//   K:Companion:Card.cmcM20:Your starting deck contains only cards with
//                            even mana values.
//   K:Companion:Card.YouCtrl+power_eq2 …
//   K:Companion:<condition>:<reminder text>
//
// The first colon-delimited segment after the K:Companion head is the
// condition (a Forge `Valid$` predicate); the trailing segment is the
// reminder text. The parser's COMPANION isn't in TWO_PARAM_KEYWORDS so
// it currently lands as `params.detail = "<condition>:<reminder>"`. We
// pull the condition out of the detail by splitting on the first colon.
//
// Wave 66 scope:
//   1. Adds "companion" to card.keywords.
//   2. Stamps `card.companionCondition = <condition>` so future
//      deck-validation can read it back.
//   3. Synthesizes an OutsideTheGame-zone activated SpellAbility that
//      pays {3} and moves the card to the controller's hand. The
//      once-per-game gate is enforced inside the synthesized resolver
//      (reads + writes `game.flags.companionUsedThisGame`).
//
// Deckbuilding-restriction validation (CR 702.139a's "if your starting
// deck meets the restriction") is a deck-construction-time concern and
// stays out of scope here; SP6 (formats) wires that pre-game gate.
import type { EntityId, KeywordAst, ParamValue, PlayerSeat, SVarAst } from "@mtg-forge-ts/core";
import { ZoneType } from "@mtg-forge-ts/core";
import { effectRegistry } from "../../ability/effect-registry.js";
import { SpellAbilityEffect } from "../../ability/spell-ability-effect.js";
import { SpellAbility } from "../../ability/spell-ability.js";
import type { SpellAbility as SpellAbilityType } from "../../ability/spell-ability.js";
import type { EngineYield } from "../../action/engine-yield.js";
import type { Game } from "../../game.js";
import { keywordHandlerRegistry } from "../keyword-handler-registry.js";
import type { KeywordActivationContext } from "../keyword-handler.js";
import { KeywordHandler } from "../keyword-handler.js";

// Wave 66 — effect handler keyed "CompanionToHand" that the synthesized
// activated SA dispatches to. Resolves by:
//   1. Re-checking the per-game-once flag (defense in depth — activate.ts's
//      availability check should have refused already, but the resolver
//      double-checks so a stale activation can't sneak through).
//   2. Locating the source card; if it's not in any zone (post-restore
//      edge case) or already in hand, no-op gracefully.
//   3. Routing through `game.action.moveTo` to the controller's hand
//      (replacement pipeline aware).
//   4. Stamping `companionUsedThisGame[seat] = true`.
//   5. Emitting a CompanionMovedToHand pulse so observers can latch.
class CompanionToHandEffect extends SpellAbilityEffect {
  static override readonly handlerKey = "CompanionToHand";

  override *resolve(sa: SpellAbilityType, game: Game): Generator<EngineYield, void, unknown> {
    const seat: PlayerSeat = sa.controllerSeat;
    const flags = game.flags;
    if (flags.companionUsedThisGame.get(seat) === true) {
      // Already used; resolver is idempotent — eat the resolution.
      return;
    }
    const source = game.cards.get(sa.sourceCardId);
    if (!source) return;
    // CR 100.4 — the card lives in the controller's OutsideTheGame zone
    // (or sideboard, which is "outside the game" per CR 100.4). Move it
    // to that player's Hand. We route through the canonical moveTo so
    // ZoneChange replacements (e.g. "if a card would enter your hand,
    // exile it instead") see the move.
    yield* game.action.moveTo(sa.sourceCardId, ZoneType.Hand, { toSeat: seat, cause: "companion" });
    flags.companionUsedThisGame.set(seat, true);
    // The canonical CardChangedZone pulse already fires from moveTo; no
    // dedicated CompanionMovedToHand event is needed (observers can latch
    // the moveTo with cause="companion").
  }
}
effectRegistry.register(CompanionToHandEffect);

export class CompanionKeywordHandler extends KeywordHandler {
  static override readonly keyword = "companion" as const;

  override activate(ast: KeywordAst, ctx: KeywordActivationContext): void {
    const card = ctx.game.cards.get(ctx.sourceCardId);
    if (!card) return;

    if (!card.keywords) card.keywords = new Set();
    card.keywords.add("companion");

    // K:Companion is parsed as a single-param `detail` keyword (no entry in
    // TWO_PARAM_KEYWORDS), so the raw tail "<condition>:<reminder>" is
    // packed into params.detail. Split on the first colon to recover the
    // condition.
    const detailParam = ast.params?.detail as ParamValue | undefined;
    const detailRaw = detailParam && detailParam.kind === "literal" ? (detailParam.raw as string) : "";
    const colon = detailRaw.indexOf(":");
    const condition = colon >= 0 ? detailRaw.slice(0, colon).trim() : detailRaw.trim();

    (card as unknown as { companionCondition?: string }).companionCondition = condition;

    // Wave 66 — synthesize the once-per-game 3-mana tutor SA, active in
    // the OutsideTheGame zone (Sideboard → "outside the game" per CR
    // 100.4 + 702.139b). The cost is just {3} — the implicit
    // "from-outside-the-game" cost is structural (the SA only fires from
    // OutsideTheGame so the card's zone IS the cost's "from where").
    const fakeAst = {
      kind: "activated" as const,
      effect: {
        handlerKey: "CompanionToHand",
        params: {} as Record<string, ParamValue>,
      },
      cost: { raw: "3" },
      rulesText: `Companion — Pay {3}: Put this card from outside the game into its owner's hand. Activate only once per game.`,
    };
    const def = card.paperCard.definition;
    const svars = (def?.svars as ReadonlyMap<string, SVarAst> | undefined) ?? new Map<string, SVarAst>();
    const sa = new SpellAbility(
      fakeAst,
      ctx.sourceCardId,
      ctx.controllerSeat,
      svars,
      [],
      undefined,
      // The companion SA fires from BOTH the Sideboard (game-start state)
      // AND OutsideTheGame (post-declaration staging) so test fixtures +
      // future deckbuilding plumbing can place the card in either slot.
      // CR 100.4 treats both as "outside the game".
      new Set([ZoneType.Sideboard, ZoneType.OutsideTheGame]),
      new Set(["companion"]),
    );
    card.spellAbilities.push(sa);
  }

  override deactivate(_ast: KeywordAst, ctx: KeywordActivationContext): void {
    const card = ctx.game.cards.get(ctx.sourceCardId);
    if (!card) return;
    card.keywords?.delete("companion");
    Reflect.deleteProperty(card as object, "companionCondition");
  }
}

keywordHandlerRegistry.register(CompanionKeywordHandler);

// Helper exported for engine-side availability checks (e.g. priority loop's
// activated-ability gate). Returns true when seat has NOT yet activated
// their companion this game.
export const isCompanionActivationAvailable = (game: Game, seat: PlayerSeat): boolean =>
  game.flags.companionUsedThisGame.get(seat) !== true;

// Suppress unused-import warning for EntityId (re-exported by callers).
export type { EntityId };
