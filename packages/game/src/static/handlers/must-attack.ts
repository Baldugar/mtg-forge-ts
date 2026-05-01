// SPDX-License-Identifier: GPL-3.0-or-later
// Wave 50 — MustAttack static handler. The static-modeled cousin of
// goad / "must attack each combat if able" emblems (CR 506.5 — attack
// requirements). MVP scope: register the restriction and stamp a runtime
// `mustAttack` flag onto the affected card so the SP3 attack-step UI can
// surface the requirement; combat-handler attack legality consults the
// static-side restriction directly via gatherRestrictions("mustAttack").
//
// Wave 96 — MustAttack$ <player-filter> sub-param now lands on the
// restriction's payload as a defender filter the combat-handler consumes
// when auto-attacking subjects. Tokens recognised: "You" → static's
// controller, "Opponent" → any non-controller seat. Absent: any defender.
//
// Routing: cantMustMay static, restriction kind = mustAttack.
import type { EntityId, ParamValue, PlayerSeat, StaticAbility, StaticAst } from "@mtg-forge-ts/core";
import type { Restriction } from "../../statics/cant-must-may.js";
import {
  StaticHandler,
  type StaticHandlerCtx,
  normalizeActiveInZones,
  staticHandlerRegistry,
} from "../static-handler.js";
import { buildCardIdPredicate, literalRaw } from "./restriction-helpers.js";

/**
 * Defender constraint payload attached to the mustAttack restriction.
 * `seatMatches` returns true iff the candidate defender seat satisfies
 * the MustAttack$ filter; absent filter defaults to `() => true`.
 */
export interface MustAttackDefenderPayload {
  readonly kind: "mustAttackDefender";
  readonly seatMatches: (seat: PlayerSeat) => boolean;
  /** True iff the static specified an explicit MustAttack$ filter. */
  readonly hasFilter: boolean;
}

const buildDefenderPredicate = (
  raw: string | undefined,
  staticCtrl: PlayerSeat,
): { seatMatches: (seat: PlayerSeat) => boolean; hasFilter: boolean } => {
  if (raw === undefined || raw.length === 0) {
    return { seatMatches: () => true, hasFilter: false };
  }
  const tokens = raw
    .split(",")
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
  return {
    seatMatches: (seat) => {
      for (const tok of tokens) {
        if (tok === "You" && seat === staticCtrl) return true;
        if (tok === "Opponent" && seat !== staticCtrl) return true;
        if (tok === "Player" || tok === "Any") return true;
        // Planeswalker.* tokens are not seat-resolvable here; the
        // combat-handler defaults to a player defender so those tokens
        // simply skip — the canonical attack auto-correct still fires
        // against any opponent.
      }
      return false;
    },
    hasFilter: true,
  };
};

export class MustAttackStaticHandler extends StaticHandler {
  static override readonly mode = "MustAttack" as const;

  override build(ast: StaticAst, ctx: StaticHandlerCtx): StaticAbility {
    const params: Readonly<Record<string, ParamValue>> = ast.params;
    const validRaw = literalRaw(params.ValidCard) ?? "Card.Self";
    const pred = buildCardIdPredicate(validRaw, ctx.sourceCardId, ctx.controllerSeat);

    const mustAttackRaw = literalRaw(params.MustAttack);
    const { seatMatches, hasFilter } = buildDefenderPredicate(mustAttackRaw, ctx.controllerSeat);
    const payload: MustAttackDefenderPayload = {
      kind: "mustAttackDefender",
      seatMatches,
      hasFilter,
    };

    const restriction: Restriction = {
      sourceStaticId: ctx.staticId,
      kind: "mustAttack",
      subjectFilter: (id, game) => pred(id as EntityId, game),
      payload,
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
      mode: "MustAttack",
      describe: () => restriction,
    };
  }
}

staticHandlerRegistry.register(MustAttackStaticHandler);
