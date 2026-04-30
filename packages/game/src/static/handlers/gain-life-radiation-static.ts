// SPDX-License-Identifier: GPL-3.0-or-later
// Wave 76 — GainLifeRadiation static handler. CR — Radiation
// counter mechanic (Fallout / PIP set). Forge's
// StaticAbilityGainLifeRadiation.java equivalent.
//
// Radiation is a counter on a player (not a card) that triggers
// a milling-cost on the upkeep step. The GainLifeRadiation static
// modifies the canonical Radiation interaction: instead of (or
// in addition to) the default behavior, the matched player gains
// life when they would gain Radiation counters (or vice versa) —
// the exact polarity depends on the card's intent.
//
// Forge cards using this shape (~1 card in corpus): bespoke
// Radiation-modifier statics. Forge's reference card maps
// "gain N life when you'd gain N rad" semantics.
//
// DSL (corpus):
//   S:Mode$ GainLifeRadiation | ValidPlayer$ You
//          | Amount$ 1 | Description$ ...
//
// What it does (Forge): consulted at the per-player Radiation
// counter add/remove pipeline; when ValidPlayer$ matches the
// player gaining radiation, an additional life-gain (or life-
// loss replacement) is layered on. Routing via ruleChanging
// because it overrides the canonical Radiation rule rather than
// gating an action.
//
// MVP scope: forward-compat stub. Our codebase has no Radiation
// counter infra yet — there is no per-player Radiation counter
// slot, no upkeep mill trigger, no AB$ AddRadCounters handler.
// The static still registers (so ports of cards with this S:
// line don't break the parser) and the `radiationLifeMod(seat)`
// helper is exposed so the future Radiation pipeline can read
// it uniformly. TODO(advanced) — wire into the Radiation
// counter add/remove pipeline once the Radiation mechanic lands.
import type { ParamValue, PlayerSeat, StaticAbility, StaticAst } from "@mtg-forge-ts/core";
import {
  StaticHandler,
  type StaticHandlerCtx,
  normalizeActiveInZones,
  staticHandlerRegistry,
} from "../static-handler.js";
import { buildPlayerPredicate, literalRaw } from "./restriction-helpers.js";

export interface GainLifeRadiationPayload {
  readonly kind: "gainLifeRadiation";
  readonly playerMatches: (seat: PlayerSeat) => boolean;
  /** Per-radiation life-gain amount; defaults to 1. */
  readonly amount: number;
}

const parseAmount = (raw: string | undefined): number => {
  if (raw === undefined || raw.length === 0) return 1;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : 1;
};

export class GainLifeRadiationStaticHandler extends StaticHandler {
  static override readonly mode = "GainLifeRadiation" as const;

  override build(ast: StaticAst, ctx: StaticHandlerCtx): StaticAbility {
    const params: Readonly<Record<string, ParamValue>> = ast.params;
    const validPlayerRaw = literalRaw(params.ValidPlayer);
    const seatPred = buildPlayerPredicate(validPlayerRaw, ctx.controllerSeat);
    const amount = parseAmount(literalRaw(params.Amount));

    const payload: GainLifeRadiationPayload = {
      kind: "gainLifeRadiation",
      playerMatches: (seat) => seatPred(seat),
      amount,
    };

    const activeInZones = normalizeActiveInZones(ast.activeInZones);
    return {
      id: ctx.staticId,
      kind: "static",
      sourceCardId: ctx.sourceCardId,
      activeInZones,
      timestamp: ctx.game.newEntityId(),
      controllerSeatAtReg: ctx.controllerSeat,
      category: "ruleChanging",
      mode: "GainLifeRadiation",
      describe: () => payload,
    };
  }
}

staticHandlerRegistry.register(GainLifeRadiationStaticHandler);
