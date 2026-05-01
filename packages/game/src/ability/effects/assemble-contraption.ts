// SPDX-License-Identifier: GPL-3.0-or-later
// AssembleContraptionEffect — Forge `SP$ AssembleContraption` (Steamflogger
// Boss family / Unstable / Unfinity contraption mechanic). Puts the top
// card of the controller's contraption deck onto a chosen sprocket as an
// assembled contraption.
//
// Forge DSL examples:
//   A:SP$ AssembleContraption | Amount$ X
//   A:SP$ AssembleContraption | Amount$ 2
//
// MVP scope (Wave 45 — final long-tail):
//   - Amount$ N — number of contraptions to assemble.
//   - When the controlling Player has a non-empty `contraptionDeck`, pop
//     the top card of that deck into the battlefield (no sprocket
//     selection — the card's slot is preserved for the SP4 wiring).
//   - Otherwise, emit a `ContraptionAssembled` pulse + stamp the assemble
//     count on game.flags.attractions[seat] for deterministic test
//     introspection.
//
// Wave 87 — sprocket choice. Forge models contraptions as a sub-zone of
// Battlefield assigned to one of THREE sprockets (1, 2, 3). Each
// AssembleContraption resolution yields a `chooseSprocket` decision so
// the controller picks where the new contraption lands; when no
// controller responds we land on the canonical default sprocket
// (`source.preferredSprocket` if set, otherwise sprocket 1). The chosen
// sprocket id is stamped on the moved card via `card.assignedSprocket`
// AND tracked on the source's `lastAssembledSprocket` slot so per-source
// "Crank the sprocket where this contraption lives" lookups work
// without rebuilding the sub-zone.
//
// Wave 117 — contraption-shuffle on assemble + "When you crank a
// contraption" trigger family. CR 308.3: when AssembleContraption
// resolves with an empty contraption deck, the contraption discard
// pile is shuffled back in to refill it before the top card is popped.
// The Cranked trigger family lands via the AdvanceCrank emission path
// (per-contraption CardCranked + a deck-event ContraptionCranked
// pulse), see wave-19-effects.ts AdvanceCrankEffect.
import { ZoneType } from "@mtg-forge-ts/core";
import type { DecisionResponse } from "@mtg-forge-ts/core";
import type { EngineYield } from "../../action/engine-yield.js";
import type { Game } from "../../game.js";
import type { AssembleContraptionIntent } from "../../replacements/mutation-intent.js";
import { effectRegistry } from "../effect-registry.js";
import { evaluateParamNumber, hasParam } from "../evaluate-param.js";
import { SpellAbilityEffect } from "../spell-ability-effect.js";
import type { SpellAbility } from "../spell-ability.js";

const SPROCKETS: readonly number[] = [1, 2, 3];

export class AssembleContraptionEffect extends SpellAbilityEffect {
  static override readonly handlerKey = "AssembleContraption";

  override *resolve(sa: SpellAbility, game: Game): Generator<EngineYield, void, unknown> {
    const num = hasParam(sa, "Amount") ? evaluateParamNumber(sa, "Amount", game) : 1;
    const player = game.getPlayer(sa.controllerSeat);
    const deck = player.contraptionDeck;
    const source = game.cards.get(sa.sourceCardId);
    for (let i = 0; i < num; i++) {
      const intent: AssembleContraptionIntent = {
        kind: "assembleContraption",
        seat: sa.controllerSeat,
      };
      void intent;
      // Wave 87 — yield a chooseSprocket decision so the controller
      // picks where this contraption lands. Default to the canonical
      // first sprocket on missing / out-of-range responses.
      const rawResponse = yield {
        kind: "decision",
        request: {
          kind: "chooseSprocket",
          sourceId: sa.sourceCardId,
          sprockets: SPROCKETS,
        },
      };
      const response = rawResponse as DecisionResponse | undefined;
      let chosenSprocket = 1;
      if (response && response.kind === "chooseSprocket" && SPROCKETS.includes(response.sprocket)) {
        chosenSprocket = response.sprocket;
      } else {
        const preferred = source as { preferredSprocket?: number } | undefined;
        if (preferred?.preferredSprocket !== undefined && SPROCKETS.includes(preferred.preferredSprocket)) {
          chosenSprocket = preferred.preferredSprocket;
        }
      }

      // Wave 45 — when a contraption deck is wired, pop the top into the
      // battlefield. Otherwise fall through to the legacy attraction-flag
      // bump + ContraptionAssembled pulse.
      // Wave 117 — when the deck is wired but empty AND the discard pile
      // has contents, shuffle the discard back in (CR 308.3) before
      // popping. This is the canonical "refill from junkyard" step Forge
      // implements via Player.advanceCrankCounter / Junkyard cycling.
      let movedCardId: Parameters<Game["cards"]["get"]>[0] | undefined;
      if (deck !== undefined && deck.size === 0 && player.contraptionDiscard.length > 0) {
        const shuffled = game.rng.shuffle(player.contraptionDiscard);
        for (const id of shuffled) deck.add(id);
        player.contraptionDiscard.length = 0;
      }
      if (deck !== undefined && deck.size > 0) {
        const topId = deck.peekAt(0);
        if (topId !== undefined) {
          deck.remove(topId);
          const bf = player.zones.get(ZoneType.Battlefield);
          if (bf) bf.add(topId);
          const card = game.cards.get(topId);
          if (card) {
            (card as unknown as { zone: ZoneType }).zone = ZoneType.Battlefield;
            (card as unknown as { assignedSprocket?: number }).assignedSprocket = chosenSprocket;
          }
          movedCardId = topId;
        }
      }
      // Track the chosen sprocket on the source so per-source lookups
      // observe the latest assembly even when the contraption deck is
      // empty (legacy MVP path).
      if (source) {
        (source as unknown as { lastAssembledSprocket?: number }).lastAssembledSprocket = chosenSprocket;
      }
      yield game.emitEvent({
        kind: "ContraptionAssembled",
        version: 1,
        turn: game.turn,
        phase: game.phase,
        payload: {
          playerSeat: sa.controllerSeat,
          sourceCardId: sa.sourceCardId,
          ...(movedCardId !== undefined ? { cardId: movedCardId } : {}),
        },
      });
    }
    // Track the count on flags so tests can verify the effect ran. Also
    // stamp `attractions` on the source card for downstream state-checks
    // ("CARDNAME has assembled N contraptions") so they observe the bump.
    const prior = game.flags.attractions.get(sa.controllerSeat) as
      | { assembledContraptions?: number }
      | undefined;
    const assembled = (prior?.assembledContraptions ?? 0) + num;
    game.flags.attractions.set(sa.controllerSeat, { assembledContraptions: assembled });
    if (source) {
      source.attractions = (source.attractions ?? 0) + num;
    }
  }
}

effectRegistry.register(AssembleContraptionEffect);
