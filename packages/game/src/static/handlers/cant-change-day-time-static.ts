// SPDX-License-Identifier: GPL-3.0-or-later
// Wave 70.P — CantChangeDayTime static handler. CR 726 —
// Innistrad: Midnight Hunt Day/Night cycle.
//
// Forge cards using this shape (~1 card in corpus):
//   - Angel of Eternal Dawn ("It can't become night.")
//
// DSL (corpus):
//   S:Mode$ CantChangeDayTime | NewTime$ Night | Description$ ...
//
// What it does (Forge): consulted at the day/night transition site
// (day-night-tracker.tryUpkeepTransition + any explicit setDayNight
// effect). When the proposed new time matches NewTime$, the
// transition is rejected silently — no DayTimeChanged event fires,
// the daybound/nightbound auto-flip pass is skipped. Mirrors Wave
// 70.O's CantPhaseIn shape on the day/night-state side.
//
// Routing: ruleChanging per MODE_TO_CATEGORY. Pure rule override
// consulted by the day/night transition path; mirrors Wave 70.F's
// IgnoreLandwalk pattern: walk the registry per-query at the
// decision site.
//
// MVP scope:
//   - NewTime$ Day / Night — the proposed new time the gate blocks.
//                              "neither" is valid in the enum but
//                              never observed in corpus.
import type { ParamValue, StaticAbility, StaticAst } from "@mtg-forge-ts/core";
import {
  StaticHandler,
  type StaticHandlerCtx,
  normalizeActiveInZones,
  staticHandlerRegistry,
} from "../static-handler.js";
import { literalRaw } from "./restriction-helpers.js";

export type DayNightState = "day" | "night" | "neither";

const parseNewTime = (raw: string | undefined): ((newTime: DayNightState) => boolean) => {
  if (raw === undefined || raw.length === 0) return () => true;
  const want = raw.toLowerCase();
  return (newTime: DayNightState) => (newTime as string).toLowerCase() === want;
};

export interface CantChangeDayTimePayload {
  readonly kind: "cantChangeDayTime";
  /**
   * True iff the proposed new state matches NewTime$ (the gate fires
   * for that proposed transition target). When true, the transition
   * is silently rejected.
   */
  readonly newTimeMatches: (newTime: DayNightState) => boolean;
}

export class CantChangeDayTimeStaticHandler extends StaticHandler {
  static override readonly mode = "CantChangeDayTime" as const;

  override build(ast: StaticAst, ctx: StaticHandlerCtx): StaticAbility {
    const params: Readonly<Record<string, ParamValue>> = ast.params;
    const newTimeRaw = literalRaw(params.NewTime);
    const newTimePred = parseNewTime(newTimeRaw);

    const payload: CantChangeDayTimePayload = {
      kind: "cantChangeDayTime",
      newTimeMatches: (newTime) => newTimePred(newTime),
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
      mode: "CantChangeDayTime",
      describe: () => payload,
    };
  }
}

staticHandlerRegistry.register(CantChangeDayTimeStaticHandler);
