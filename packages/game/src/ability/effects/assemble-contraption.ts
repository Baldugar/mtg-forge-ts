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
// TODO(advanced): full contraption deck integration — sprocket choice,
// contraption-shuffle on assemble, "When you crank a contraption" trigger
// hookup. Forge models contraptions as a sub-zone of Battlefield with a
// rotating sprocket id. Once the cards-package surfaces a real contraption
// deck, the placeholder branch below will give way to the deck-pop path.
import { ZoneType } from "@mtg-forge-ts/core";
import type { EngineYield } from "../../action/engine-yield.js";
import type { Game } from "../../game.js";
import type { AssembleContraptionIntent } from "../../replacements/mutation-intent.js";
import { effectRegistry } from "../effect-registry.js";
import { evaluateParamNumber, hasParam } from "../evaluate-param.js";
import { SpellAbilityEffect } from "../spell-ability-effect.js";
import type { SpellAbility } from "../spell-ability.js";

export class AssembleContraptionEffect extends SpellAbilityEffect {
  static override readonly handlerKey = "AssembleContraption";

  override *resolve(sa: SpellAbility, game: Game): Generator<EngineYield, void, unknown> {
    const num = hasParam(sa, "Amount") ? evaluateParamNumber(sa, "Amount", game) : 1;
    const player = game.getPlayer(sa.controllerSeat);
    const deck = player.contraptionDeck;
    for (let i = 0; i < num; i++) {
      const intent: AssembleContraptionIntent = {
        kind: "assembleContraption",
        seat: sa.controllerSeat,
      };
      void intent;
      // Wave 45 — when a contraption deck is wired, pop the top into the
      // battlefield. Otherwise fall through to the legacy attraction-flag
      // bump + ContraptionAssembled pulse.
      let movedCardId: Parameters<Game["cards"]["get"]>[0] | undefined;
      if (deck !== undefined && deck.size > 0) {
        const topId = deck.peekAt(0);
        if (topId !== undefined) {
          deck.remove(topId);
          const bf = player.zones.get(ZoneType.Battlefield);
          if (bf) bf.add(topId);
          const card = game.cards.get(topId);
          if (card) {
            (card as unknown as { zone: ZoneType }).zone = ZoneType.Battlefield;
          }
          movedCardId = topId;
        }
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
    const source = game.cards.get(sa.sourceCardId);
    if (source) {
      source.attractions = (source.attractions ?? 0) + num;
    }
  }
}

effectRegistry.register(AssembleContraptionEffect);
