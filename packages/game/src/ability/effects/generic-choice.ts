// SPDX-License-Identifier: GPL-3.0-or-later
// GenericChoiceEffect — Forge `SP$ GenericChoice` / `DB$ GenericChoice`
// (Abundant Harvest's "land or nonland" choice; modal "pick one of these
// SVar names"). Yields a `chooseGenericOption` decision, then resolves the
// SVar named by the chosen optionId as if it were the next sub-ability.
//
// Forge DSL examples:
//   A:SP$ GenericChoice | Choices$ DigLand,DigNonland
//   SVar:AbundantChoice:DB$ GenericChoice | Choices$ DigLand,DigNonland | Defined$ You
//
// Choices$ format: comma-separated SVar names. Each name must resolve to
// an `ability` SVar in sa.svars; chosen one is built into a SpellAbility
// and resolved inline (same pattern as RepeatEachEffect / EffectEffect's
// SubAbility$ chaining).
//
// MVP scope:
//   - Choices$ split by comma → option list (id == SVar name, description
//     defaults to the SVar name; SP4 will plumb richer descriptions).
//   - Default decider: the controller (Forge's `Defined$ You` is the most
//     common form; Defined$ Opponent flips to the 2-player opponent).
import type { DecisionResponse, EntityId, NamedOption } from "@mtg-forge-ts/core";
import { mkPlayerSeat } from "@mtg-forge-ts/core";
import type { AbilityAst } from "@mtg-forge-ts/core";
import type { EngineYield } from "../../action/engine-yield.js";
import type { Game } from "../../game.js";
import { effectRegistry } from "../effect-registry.js";
import { evaluateParamRaw, hasParam } from "../evaluate-param.js";
import { SpellAbilityEffect } from "../spell-ability-effect.js";
import { SpellAbility } from "../spell-ability.js";

export class GenericChoiceEffect extends SpellAbilityEffect {
  static override readonly handlerKey = "GenericChoice";

  override *resolve(sa: SpellAbility, game: Game): Generator<EngineYield, void, unknown> {
    const choicesRaw = hasParam(sa, "Choices") ? evaluateParamRaw(sa, "Choices") : "";
    const optionNames = choicesRaw
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    if (optionNames.length === 0) return;

    // Determine deciding seat — Defined$ You/Opponent.
    let deciderSeat = sa.controllerSeat;
    if (hasParam(sa, "Defined")) {
      const def = evaluateParamRaw(sa, "Defined").trim();
      if (def === "Player.Opponent" || def === "Opponent") {
        const n = sa.controllerSeat as unknown as number;
        deciderSeat = mkPlayerSeat(n === 0 ? 1 : 0);
      }
    }

    const options: NamedOption[] = optionNames.map((n) => ({ id: n, description: n }));

    const rawResponse = yield {
      kind: "decision",
      request: {
        kind: "chooseGenericOption",
        sourceId: sa.sourceCardId,
        playerSeat: deciderSeat,
        options,
      },
    };

    const response = rawResponse as DecisionResponse | undefined;
    let chosen = optionNames[0] ?? "";
    if (response && response.kind === "chooseGenericOption") {
      if (optionNames.includes(response.optionId)) chosen = response.optionId;
    }
    if (!chosen) return;

    // Resolve chosen SVar as a sub-ability.
    const sv = sa.svars.get(chosen);
    if (!sv || sv.kind !== "ability" || !sv.ability) return;

    const fakeAst: AbilityAst = {
      kind: "spell",
      effect: sv.ability,
      cost: { raw: "" },
    };
    const subSa = new SpellAbility(fakeAst, sa.sourceCardId, sa.controllerSeat, sa.svars, [] as EntityId[]);
    const resolver = subSa.makeResolver();
    yield* resolver.resolve(game) as Generator<EngineYield, void, unknown>;
  }
}

effectRegistry.register(GenericChoiceEffect);
