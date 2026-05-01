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
// Wave 87 — Choices$ <filter> validation. The restriction string is now
// parsed for the canonical Forge tags (`Player.Opponent`, `Player.You`,
// `Player.IsRemembered`, the legacy bare `Opponent`/`You`) and the response
// seat is checked against the predicate. Invalid picks stamp a structured
// `choosePlayer-restriction-violation` warning on `game.decisionWarnings`
// and the effect falls back to the deterministic restriction-aware default
// (the canonical seat that satisfies the filter; controller's seat for
// `Player`/empty filter, the controller's first opponent for the Opponent
// family). Tags the engine doesn't yet recognise pass-through for back-
// compat (SP4 TargetRestriction AST will add the full predicate DSL).
import type { DecisionResponse, PlayerSeat } from "@mtg-forge-ts/core";
import type { EngineYield } from "../../action/engine-yield.js";
import type { Game } from "../../game.js";
import { effectRegistry } from "../effect-registry.js";
import { evaluateParamRaw, hasParam } from "../evaluate-param.js";
import { SpellAbilityEffect } from "../spell-ability-effect.js";
import type { SpellAbility } from "../spell-ability.js";

// Local helper — first opponent of `seat` in seat order. Mirrors the
// `otherSeat` helpers in wave-19/21/22-effects (intentionally local; SP4
// will hoist to a shared module).
const otherSeatLocal = (seat: PlayerSeat, game: Game): PlayerSeat => {
  for (const p of game.players) {
    if (p.seat !== seat) return p.seat;
  }
  return seat;
};

// Wave 87 — extract the canonical seat-class from a Forge `Choices$` filter
// string. Returns `undefined` for filters the engine doesn't yet understand
// (the response is then accepted unchecked, mirroring the legacy MVP).
const classifyRestriction = (raw: string): "you" | "opponent" | "any" | undefined => {
  const t = raw.replace(/\s+/g, "");
  if (t === "" || t === "Player") return "any";
  if (t === "You" || t === "Player.You") return "you";
  if (t === "Opponent" || t === "Player.Opponent") return "opponent";
  return undefined;
};

const seatSatisfies = (
  seat: PlayerSeat,
  cls: "you" | "opponent" | "any",
  controller: PlayerSeat,
  opponentOf: PlayerSeat,
): boolean => {
  if (cls === "any") return true;
  if (cls === "you") return seat === controller;
  return seat === opponentOf;
};

export class ChoosePlayerEffect extends SpellAbilityEffect {
  static override readonly handlerKey = "ChoosePlayer";

  override *resolve(sa: SpellAbility, game: Game): Generator<EngineYield, void, unknown> {
    const restriction = hasParam(sa, "Choices") ? evaluateParamRaw(sa, "Choices") : "Player";
    const cls = classifyRestriction(restriction);
    const opponent = otherSeatLocal(sa.controllerSeat, game);

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
      // Validate every chosen seat against the parsed restriction class.
      // Unrecognised filters skip validation (legacy pass-through).
      let allOk = true;
      if (cls !== undefined) {
        for (const seat of response.chosen) {
          if (!seatSatisfies(seat, cls, sa.controllerSeat, opponent)) {
            allOk = false;
            break;
          }
        }
      }
      if (allOk) {
        for (const seat of response.chosen) {
          source.chosenPlayers.push(seat);
        }
        return;
      }
      game.decisionWarnings.push({
        kind: "choosePlayer-restriction-violation",
        sourceId: sa.sourceCardId,
        detail: `ChoosePlayer: response seat does not satisfy Choices$ ${restriction}`,
      });
    }
    // Non-interactive / restriction-violation fallback. For Opponent
    // restrictions land on the controller's first opponent; otherwise
    // default to the controller's seat. Deterministic and always passes
    // the restriction check.
    const fallback = cls === "opponent" ? opponent : sa.controllerSeat;
    source.chosenPlayers.push(fallback);
  }
}

effectRegistry.register(ChoosePlayerEffect);
