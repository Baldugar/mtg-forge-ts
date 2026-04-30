// SPDX-License-Identifier: GPL-3.0-or-later
// Wave 70.M — PlayerMustAttack static handler. Forge's
// StaticAbilityMustAttack.mustAttackSpecific(...) — a positive
// requirement that the matched player attack with at least one
// creature each combat if able, optionally restricted to attacking
// specific defenders (player / planeswalker).
//
// Forge cards using this (2 cards in corpus):
//   - Seeker of Slaanesh        ("Each opponent must attack with at
//                                  least one creature each combat if
//                                  able.")
//   - Trove of Temptation       ("Each opponent must attack you or a
//                                  planeswalker you control with at
//                                  least one creature each combat if
//                                  able.")
//
// DSL examples (corpus):
//   S:Mode$ PlayerMustAttack | ValidPlayer$ Opponent
//   S:Mode$ PlayerMustAttack | ValidPlayer$ Opponent
//                            | MustAttack$ You,Planeswalker.YouCtrl
//
// What it does (Forge): consulted at declareAttackers time. When the
// matched player declares attackers, at least one of their creatures
// that CAN attack must attack — and when MustAttack$ is present, the
// declared attack target must match the filter (defender player /
// planeswalker subset).
//
// Routing: cantMustMay per MODE_TO_CATEGORY. Read-side helper
// (`playerMustAttackRequirement` in wave70m-gate-helpers.ts) walks
// the registry per-declareAttackers query and surfaces the
// requirement payload.
//
// MVP scope:
//   - ValidPlayer$ <filter>      → buildPlayerPredicate (Wave 50
//                                   grammar: You / Opponent / Player /
//                                   Any). Selects which players the
//                                   requirement applies to.
//   - MustAttack$ <filter>       → optional defender-target restriction.
//                                   Comma-separated tokens recognised:
//                                   "You" → defender must be the
//                                     static's controller.
//                                   "Planeswalker.YouCtrl" → defender
//                                     must be a planeswalker controlled
//                                     by the static's controller.
//                                   "Opponent" / "Planeswalker.OppCtrl"
//                                     forwarded for forward-compat.
//                                   Empty / undefined → any defender.
import type { ParamValue, PlayerSeat, StaticAbility, StaticAst } from "@mtg-forge-ts/core";
import {
  StaticHandler,
  type StaticHandlerCtx,
  normalizeActiveInZones,
  staticHandlerRegistry,
} from "../static-handler.js";
import { buildPlayerPredicate, literalRaw } from "./restriction-helpers.js";

/**
 * Defender classification used by the requirement payload to decide
 * whether a candidate attack target satisfies the gate. The two
 * supported shapes (per the corpus): a Player defender or a
 * Planeswalker defender. `controllerSeat` is the player who controls
 * the planeswalker (if any).
 */
export interface PlayerMustAttackDefender {
  readonly kind: "player" | "planeswalker";
  readonly controllerSeat: PlayerSeat;
}

/**
 * Read-side payload exposing the per-side predicates the requirement
 * consults. The combat-handler at declareAttackers walks active gates,
 * filters by `playerMatches(attackingSeat)`, and (for the matched
 * subset) surfaces the requirement: at least one creature that can
 * attack a defender for which `defenderMatches(d)` is true MUST
 * attack such a defender.
 */
export interface PlayerMustAttackPayload {
  readonly kind: "playerMustAttack";
  /** True iff the attacking player matches the static's ValidPlayer$ filter. */
  readonly playerMatches: (seat: PlayerSeat) => boolean;
  /**
   * True iff the candidate defender matches the static's MustAttack$
   * filter. When MustAttack$ is absent, every defender matches
   * (canonical "any defender" requirement).
   */
  readonly defenderMatches: (d: PlayerMustAttackDefender) => boolean;
  /** Whether MustAttack$ is set (true) or absent (false). */
  readonly hasMustAttackFilter: boolean;
}

const matchMustAttack = (
  raw: string | undefined,
  staticCtrl: PlayerSeat,
): ((d: PlayerMustAttackDefender) => boolean) => {
  if (raw === undefined || raw.length === 0) return () => true;
  const tokens = raw
    .split(",")
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
  return (d: PlayerMustAttackDefender) => {
    for (const tok of tokens) {
      if (tok === "You" && d.kind === "player" && d.controllerSeat === staticCtrl) return true;
      if (tok === "Opponent" && d.kind === "player" && d.controllerSeat !== staticCtrl) return true;
      if (tok === "Planeswalker.YouCtrl" && d.kind === "planeswalker" && d.controllerSeat === staticCtrl)
        return true;
      if (tok === "Planeswalker.OppCtrl" && d.kind === "planeswalker" && d.controllerSeat !== staticCtrl)
        return true;
      if (tok === "Planeswalker" && d.kind === "planeswalker") return true;
      if (tok === "Player" && d.kind === "player") return true;
      // Any other token: conservative miss (TODO(advanced)).
    }
    return false;
  };
};

export class PlayerMustAttackStaticHandler extends StaticHandler {
  static override readonly mode = "PlayerMustAttack" as const;

  override build(ast: StaticAst, ctx: StaticHandlerCtx): StaticAbility {
    const params: Readonly<Record<string, ParamValue>> = ast.params;
    const validPlayerRaw = literalRaw(params.ValidPlayer);
    const mustAttackRaw = literalRaw(params.MustAttack);

    const playerPred = buildPlayerPredicate(validPlayerRaw, ctx.controllerSeat);
    const defenderPred = matchMustAttack(mustAttackRaw, ctx.controllerSeat);

    const payload: PlayerMustAttackPayload = {
      kind: "playerMustAttack",
      playerMatches: (seat) => playerPred(seat),
      defenderMatches: (d) => defenderPred(d),
      hasMustAttackFilter: mustAttackRaw !== undefined && mustAttackRaw.length > 0,
    };

    const activeInZones = normalizeActiveInZones(ast.activeInZones);
    return {
      id: ctx.staticId,
      kind: "static",
      sourceCardId: ctx.sourceCardId,
      activeInZones,
      timestamp: ctx.game.newEntityId(),
      controllerSeatAtReg: ctx.controllerSeat,
      category: "cantMustMay",
      mode: "PlayerMustAttack",
      describe: () => payload,
    };
  }
}

staticHandlerRegistry.register(PlayerMustAttackStaticHandler);
