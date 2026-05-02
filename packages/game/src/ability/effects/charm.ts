// SPDX-License-Identifier: GPL-3.0-or-later
// CharmEffect — modal spell dispatcher (Charm archetype, 85+ cards).
//
// Forge DSL:
//   A:SP$ Charm | Cost$ 1 R | CharmNum$ 1 | Choices$ DBDamage,DBPump,DBDestroy
//   SVar:DBDamage:DB$ DealDamage | NumDmg$ 2 | ValidTgts$ Any
//
// The caster picks CharmNum$ modes from the Choices$ list. Each chosen mode
// is an SVar that resolves as its own sub-ability (EffectInvocation). Modes
// are dispatched in the order the player chose them; each sub-ability runs
// to completion before the next begins.
//
// Decision kind: chooseModes (player-decisions.ts). Response field: modeIds.
// Fallback (no driver / deterministic): first CharmNum$ choices in list order.
import type { DecisionResponse } from "@mtg-forge-ts/core";
import type { EngineYield } from "../../action/engine-yield.js";
import type { Game } from "../../game.js";
import { evaluateSVarAsAbility } from "../../svar/ability-eval.js";
import type { SvarContext } from "../../svar/context.js";
import { effectRegistry } from "../effect-registry.js";
import { evaluateParamNumber, evaluateParamRaw, hasParam } from "../evaluate-param.js";
import { SpellAbilityEffect } from "../spell-ability-effect.js";
import { SpellAbility } from "../spell-ability.js";

export class CharmEffect extends SpellAbilityEffect {
  static override readonly handlerKey = "Charm";

  override *resolve(sa: SpellAbility, game: Game): Generator<EngineYield, void, unknown> {
    // M6.16 — Forge sometimes uses bare `Charm$ True` flags on legacy
    // charm cards whose modes are stored as `Choices$ DBA,DBB,DBC` on
    // their `A:` line; older fixtures may omit the explicit Choices$ list
    // entirely. Without choices the modal dispatch has nothing to do; bail
    // gracefully rather than throwing the un-actionable
    // "no param 'Choices' on Charm" error.
    if (!hasParam(sa, "Choices")) return;
    const choicesRaw = evaluateParamRaw(sa, "Choices");
    const choices = choicesRaw
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s !== "");

    const charmNum = hasParam(sa, "CharmNum") ? evaluateParamNumber(sa, "CharmNum", game) : 1;

    // Build the SVar context for sub-ability lookup.
    const ctx: SvarContext = {
      game,
      sourceCardId: sa.sourceCardId,
      svars: sa.svars,
      controller: sa.controllerSeat,
      targets: sa.targets,
      ...(sa.xValue !== undefined ? { xValue: sa.xValue } : {}),
    };

    // Wave 61.C — Spree fast path. When the source card was cast as a
    // Spree spell, the cast pipeline's stepDetermineTotalCost already
    // yielded a `chooseSpreeModes` decision and stamped the chosen mode
    // ids onto `card.spreeChosenModes`. Honor that pre-pick instead of
    // yielding a fresh chooseModes — re-prompting would let the caster
    // resolve modes they didn't pay the additional cost for. Validate
    // that each pre-chosen id is in the printed Choices$ list (defensive:
    // the cast pipeline's own validation already restricts to printed
    // modes). On any mismatch fall back to the canonical chooseModes
    // path so a stale stamp can't deadlock resolution.
    const sourceCard = game.cards.get(sa.sourceCardId);
    let picked: readonly string[] | undefined;
    if (sourceCard?.isSpree === true && sourceCard.spreeChosenModes !== undefined) {
      const printed = new Set(choices);
      const stamped = sourceCard.spreeChosenModes.filter((id) => printed.has(id));
      if (stamped.length > 0) {
        picked = stamped;
      }
    }

    if (picked === undefined) {
      // Yield decision: ask the controller to pick charmNum modes.
      const modeOptions = choices.map((name) => ({ id: name, description: name }));
      const rawResponse = yield {
        kind: "decision",
        request: {
          kind: "chooseModes",
          sourceId: sa.sourceCardId,
          modes: modeOptions,
          min: charmNum,
          max: charmNum,
        },
      };

      const response = rawResponse as DecisionResponse | undefined;
      if (response && response.kind === "chooseModes") {
        picked = response.modeIds;
      } else {
        // Deterministic fallback: first charmNum choices (for tests without a driver).
        picked = choices.slice(0, charmNum);
      }
    }

    // Resolve each chosen mode as a sub-ability.
    for (const name of picked) {
      const ability = evaluateSVarAsAbility(name, ctx);
      const subAst = {
        kind: "spell" as const,
        effect: ability,
        cost: { raw: "" },
      };
      const subSa = new SpellAbility(
        subAst,
        sa.sourceCardId,
        sa.controllerSeat,
        sa.svars,
        sa.targets,
        sa.xValue,
      );
      const cls = effectRegistry.lookup(ability.handlerKey);
      if (!cls) {
        // Unknown sub-effect — skip silently rather than crash. Caller can
        // detect missing registration via effectRegistry.has() separately.
        continue;
      }
      yield* new cls().resolve(subSa, game);
    }
  }
}

effectRegistry.register(CharmEffect);
