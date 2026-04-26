// SPDX-License-Identifier: GPL-3.0-or-later
// PlotEffect — resolution side of the Plot keyword's synthesized hand-zone
// activated ability (Bloomburrow / CR 718).
//
// CR 718.1 — "Plot [cost]" lets the controller, during their main phase at
// sorcery speed, exile this card from their hand face-up for the plot cost.
// On a LATER turn the card may be cast from exile for free (handled by the
// Plot AltCost in altcost/plot.ts).
//
// Resolution responsibilities:
//   1. Move the source card from Hand to (shared) Exile face-up — the
//      face-down state semantics from Foretell do NOT apply; Plot is face-
//      up by rule.
//   2. Stamp `card.plotted = true` and `card.plottedOnTurn = game.turn`.
//      The alt-cost path consults these to gate the "later turn" rule.
//   3. Emit `CardPlotted { playerSeat, cardId }` so any BecomesPlotted
//      triggers (wave-18) registered against this card fire.
//
// Note: this effect is a "self-targeting" handler — its target is always
// the source card (sa.sourceCardId). The synthesizing keyword handler does
// not bind targets via ValidTgts$.
import { mkEvent } from "@mtg-forge-ts/core";
import type { EngineYield } from "../../action/engine-yield.js";
import type { Game } from "../../game.js";
import { effectRegistry } from "../effect-registry.js";
import { SpellAbilityEffect } from "../spell-ability-effect.js";
import type { SpellAbility } from "../spell-ability.js";

export class PlotEffect extends SpellAbilityEffect {
  static override readonly handlerKey = "Plot";
  override *resolve(sa: SpellAbility, game: Game): Generator<EngineYield, void, unknown> {
    const card = game.cards.get(sa.sourceCardId);
    if (!card) return;

    // 1. Move source from its origin zone (typically Hand — but we tolerate
    //    any non-Exile zone in case the engine queues this resolution after
    //    a state shift) to shared Exile.
    yield* game.action.exile(sa.sourceCardId, { sourceId: sa.sourceCardId });

    // 2. Stamp plot state.
    card.plotted = true;
    card.plottedOnTurn = game.turn;

    // 3. Emit CardPlotted so BecomesPlotted triggers can react.
    yield game.emitEvent(
      mkEvent("CardPlotted", game.turn, game.phase, {
        playerSeat: sa.controllerSeat,
        cardId: sa.sourceCardId,
      }),
    );
  }
}

effectRegistry.register(PlotEffect);
