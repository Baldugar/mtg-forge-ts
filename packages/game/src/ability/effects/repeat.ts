// SPDX-License-Identifier: GPL-3.0-or-later
// RepeatEffect — Forge `SP$ Repeat` / `DB$ Repeat` (Ad Nauseam, Beacon
// of Tomorrows-style "do it then repeat", Worship-style do-N-times).
// Distinct from RepeatEachEffect (which iterates over a population) —
// Repeat runs the same SVar N times (or "until you choose to stop" with
// RepeatOptional$ True).
//
// Forge DSL examples:
//   A:SP$ Repeat | RepeatSubAbility$ DBDig | RepeatOptional$ True
//   A:SP$ Repeat | MaxRepeat$ Y | RepeatSubAbility$ DBChangeZone
//
// MVP scope:
//   - RepeatSubAbility$ <SVar> — sub-ability to resolve.
//   - MaxRepeat$ N (or default 1) — fixed iteration count.
//   - RepeatOptional$ True — yield a confirmAction decision per iteration;
//     stop on a "false" response. Fallback (no decision) runs MaxRepeat$
//     iterations (or 1) so deterministic-test paths are stable.
//
// TODO(advanced): RepeatPresent$ / RepeatSVarCompare$ continuation
// predicates (Forge corpus uses these for "until you no longer control X").
import type { AbilityAst, DecisionResponse, EntityId } from "@mtg-forge-ts/core";
import type { EngineYield } from "../../action/engine-yield.js";
import type { Game } from "../../game.js";
import { effectRegistry } from "../effect-registry.js";
import { evaluateParamNumber, evaluateParamRaw, hasParam } from "../evaluate-param.js";
import { SpellAbilityEffect } from "../spell-ability-effect.js";
import { SpellAbility } from "../spell-ability.js";

const HARD_CAP = 100;

export class RepeatEffect extends SpellAbilityEffect {
  static override readonly handlerKey = "Repeat";

  override *resolve(sa: SpellAbility, game: Game): Generator<EngineYield, void, unknown> {
    const subKey = hasParam(sa, "RepeatSubAbility") ? evaluateParamRaw(sa, "RepeatSubAbility") : "";
    if (!subKey) return;
    const sv = sa.svars.get(subKey);
    if (!sv || sv.kind !== "ability" || !sv.ability) return;

    const fakeAst: AbilityAst = {
      kind: "spell",
      effect: sv.ability,
      cost: { raw: "" },
    };

    const optional = hasParam(sa, "RepeatOptional") && evaluateParamRaw(sa, "RepeatOptional") === "True";
    const maxRepeat = hasParam(sa, "MaxRepeat") ? evaluateParamNumber(sa, "MaxRepeat", game) : 1;
    const cap = Math.min(maxRepeat, HARD_CAP);

    if (!optional) {
      // Fixed iteration count.
      for (let i = 0; i < cap; i++) {
        const subSa = new SpellAbility(
          fakeAst,
          sa.sourceCardId,
          sa.controllerSeat,
          sa.svars,
          [] as EntityId[],
        );
        yield* subSa.makeResolver().resolve(game) as Generator<EngineYield, void, unknown>;
      }
      return;
    }

    // RepeatOptional — ask the controller before each iteration.
    for (let i = 0; i < HARD_CAP; i++) {
      const rawResponse = yield {
        kind: "decision",
        request: {
          kind: "confirmAction",
          sourceId: sa.sourceCardId,
          prompt: `Repeat ${subKey} again?`,
        },
      };
      const r = rawResponse as DecisionResponse | undefined;
      const proceed = r && r.kind === "confirmAction" ? r.confirmed : i < cap;
      if (!proceed) break;
      const subSa = new SpellAbility(fakeAst, sa.sourceCardId, sa.controllerSeat, sa.svars, [] as EntityId[]);
      yield* subSa.makeResolver().resolve(game) as Generator<EngineYield, void, unknown>;
    }
  }
}

effectRegistry.register(RepeatEffect);
