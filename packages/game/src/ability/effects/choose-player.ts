// SPDX-License-Identifier: GPL-3.0-or-later
// ChoosePlayerEffect — Forge `SP$ ChoosePlayer` / `DB$ ChoosePlayer` (Backdraft,
// Benevolent Offering, Infernal Offering). Yields a `choosePlayer` decision
// (already in core), stores the chosen seat(s) on the source card's
// `chosenPlayers` slot. Mirrors ChooseColor/ChooseType in shape.
//
// Forge DSL examples:
//   A:SP$ ChoosePlayer | Defined$ You | Choices$ Player.Opponent
//   A:SP$ ChoosePlayer | Defined$ You | Choices$ Player.IsRemembered
//
// MVP scope:
//   - Yields a single-seat choice request to the controller.
//   - Stores the response on source.chosenPlayers (overwriting prior entries
//     by appending — downstream readers look at index 0).
//
// TODO(advanced): Choices$ <filter> currently passes the raw filter through
// as the request restriction string for the UI; the engine doesn't yet
// validate the response against it. SP4 TargetRestriction AST will plug in.
import type { DecisionResponse } from "@mtg-forge-ts/core";
import type { EngineYield } from "../../action/engine-yield.js";
import type { Game } from "../../game.js";
import { effectRegistry } from "../effect-registry.js";
import { evaluateParamRaw, hasParam } from "../evaluate-param.js";
import { SpellAbilityEffect } from "../spell-ability-effect.js";
import type { SpellAbility } from "../spell-ability.js";

export class ChoosePlayerEffect extends SpellAbilityEffect {
  static override readonly handlerKey = "ChoosePlayer";

  override *resolve(sa: SpellAbility, game: Game): Generator<EngineYield, void, unknown> {
    const restriction = hasParam(sa, "Choices") ? evaluateParamRaw(sa, "Choices") : "Player";

    const rawResponse = yield {
      kind: "decision",
      request: {
        kind: "choosePlayer",
        sourceId: sa.sourceCardId,
        restriction,
        min: 1,
        max: 1,
      },
    };

    const response = rawResponse as DecisionResponse | undefined;
    const source = game.cards.get(sa.sourceCardId);
    if (!source) return;

    if (response && response.kind === "choosePlayer" && response.chosen.length > 0) {
      for (const seat of response.chosen) {
        source.chosenPlayers.push(seat);
      }
    } else {
      // Non-interactive fallback: pick the controller's seat. Deterministic
      // and never produces a mismatched seat (controller always exists).
      source.chosenPlayers.push(sa.controllerSeat);
    }
  }
}

effectRegistry.register(ChoosePlayerEffect);
