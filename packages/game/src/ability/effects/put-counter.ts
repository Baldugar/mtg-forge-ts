// SPDX-License-Identifier: GPL-3.0-or-later
// PutCounterEffect — adds N counters of a given type to all targets.
// handlerKey "PutCounter" matches Forge's canonical name for AddCounter effects.
//
// Wave 53 broadens the MVP:
//   - UpTo$ True               — controller may pick "up to N"; MVP defaults
//                                to the full N (decision subsystem applies
//                                the player choice in Wave 56+).
//   - EachExistingCounter$ True — add one of each counter type already on
//                                the target (Bow of Nylea, Vorel of the
//                                Hull Clade family).
//   - EachValid$ <filter>      — instead of using sa.targets, distribute one
//                                counter to each card matching the filter
//                                (Renata, Called to the Hunt: "+1/+1 on each
//                                creature you control"). Filter syntax is
//                                the trimmed CardType name (Creature /
//                                Artifact / Enchantment / Land / Permanent),
//                                with optional .YouCtrl / .OpponentCtrl.
//   - DividedAsYouChoose$ True — controller divides total CounterNum$ across
//                                target list. MVP splits evenly.
//   - MaxFromEffect$ N         — cap counters added per target. MVP applies
//                                Math.min(n, MaxFromEffect).
//
// Wave 63.A — UpTo$ True now yields a chooseNumber decision (range 0..N)
// to the controller; valid responses pick the chosen amount, invalid
// responses fall back to the full N (matching the prior MVP behaviour).
import { CardType, ZoneType } from "@mtg-forge-ts/core";
import type { CounterType, DecisionResponse, EntityId } from "@mtg-forge-ts/core";
import type { EngineYield } from "../../action/engine-yield.js";
import type { Game } from "../../game.js";
import { effectRegistry } from "../effect-registry.js";
import { evaluateParamNumber, evaluateParamRaw, hasParam } from "../evaluate-param.js";
import { SpellAbilityEffect } from "../spell-ability-effect.js";
import type { SpellAbility } from "../spell-ability.js";

const isTrue = (raw: string | undefined): boolean => raw !== undefined && raw.trim().toLowerCase() === "true";

/**
 * Resolve EachValid$ <filter> to the set of card ids on the battlefield
 * matching that filter. Mirrors the small filter vocabulary used by
 * change-zone-all and destroy-all.
 */
function collectEachValid(filter: string, sa: SpellAbility, game: Game): readonly EntityId[] {
  const tokens = filter.split(".").map((t) => t.trim().toLowerCase());
  const baseType = tokens[0] ?? "permanent";
  const qualifier = tokens[1] ?? "";

  const matched: EntityId[] = [];
  for (const [id, card] of game.cards) {
    if (card.zone !== ZoneType.Battlefield) continue;
    const chars = game.layerEngine.computeCharacteristics(id);
    if (baseType !== "permanent") {
      if (baseType === "creature" && !chars.types.has(CardType.Creature)) continue;
      if (baseType === "artifact" && !chars.types.has(CardType.Artifact)) continue;
      if (baseType === "enchantment" && !chars.types.has(CardType.Enchantment)) continue;
      if (baseType === "land" && !chars.types.has(CardType.Land)) continue;
    }
    if (qualifier === "youctrl" && card.controllerSeat !== sa.controllerSeat) continue;
    if (qualifier === "opponentctrl" && card.controllerSeat === sa.controllerSeat) continue;
    matched.push(id);
  }
  return matched;
}

export class PutCounterEffect extends SpellAbilityEffect {
  static override readonly handlerKey = "PutCounter";
  override *resolve(sa: SpellAbility, game: Game): Generator<EngineYield, void, unknown> {
    const counterTypeRaw = hasParam(sa, "CounterType") ? evaluateParamRaw(sa, "CounterType") : undefined;
    const counterType = counterTypeRaw as CounterType | undefined;
    const baseN = hasParam(sa, "CounterNum") ? evaluateParamNumber(sa, "CounterNum", game) : 1;

    // ---- EachExistingCounter$ True ---------------------------------------
    // For each target, add one of each counter type currently on the card.
    if (
      isTrue(hasParam(sa, "EachExistingCounter") ? evaluateParamRaw(sa, "EachExistingCounter") : undefined)
    ) {
      for (const targetId of sa.targets) {
        const target = game.cards.get(targetId);
        if (!target) continue;
        const existingTypes = [...target.counters.keys()];
        for (const ct of existingTypes) {
          yield* game.action.addCounter(targetId, ct, 1, sa.sourceCardId);
        }
      }
      return;
    }

    if (counterType === undefined) return; // no-op for missing CounterType$

    // ---- EachValid$ <filter> --------------------------------------------
    // Distribute one (or N) counter to every battlefield card matching the
    // filter. Uses sa.controllerSeat for "YouCtrl" qualifier.
    if (hasParam(sa, "EachValid")) {
      const filter = evaluateParamRaw(sa, "EachValid");
      const ids = collectEachValid(filter, sa, game);
      const perCard = baseN;
      for (const id of ids) {
        yield* game.action.addCounter(id, counterType, perCard, sa.sourceCardId);
      }
      return;
    }

    // ---- DividedAsYouChoose$ True ---------------------------------------
    const divided = isTrue(
      hasParam(sa, "DividedAsYouChoose") ? evaluateParamRaw(sa, "DividedAsYouChoose") : undefined,
    );

    // ---- UpTo$ + MaxFromEffect$ ------------------------------------------
    // MaxFromEffect$ caps the count. UpTo$ True yields a chooseNumber
    // request to the controller (range 0..N) per Wave 63.A; on invalid
    // responses we fall back to the full N (the prior MVP default).
    let n = baseN;
    if (hasParam(sa, "MaxFromEffect")) {
      const cap = evaluateParamNumber(sa, "MaxFromEffect", game);
      if (Number.isFinite(cap)) n = Math.min(n, Math.max(0, cap));
    }
    const upTo = isTrue(hasParam(sa, "UpTo") ? evaluateParamRaw(sa, "UpTo") : undefined);
    if (upTo && n > 0) {
      const rawResponse = yield {
        kind: "decision",
        request: {
          kind: "chooseNumber",
          sourceId: sa.sourceCardId,
          min: 0,
          max: n,
        },
      };
      const response = rawResponse as DecisionResponse | undefined;
      if (response && response.kind === "chooseNumber") {
        const chosen = response.chosen;
        if (Number.isFinite(chosen) && chosen >= 0 && chosen <= n) {
          n = Math.floor(chosen);
        } else {
          // Wave 86 — structured-warning surface. The controller returned a
          // value outside [0, n] (or NaN). The engine falls back to the
          // legacy "full N" default but stamps a record on
          // game.decisionWarnings so test paths and the eventual UI can
          // introspect the rejection.
          game.decisionWarnings.push({
            kind: "chooseNumber-out-of-range",
            sourceId: sa.sourceCardId,
            detail: `PutCounter UpTo$: response ${String(chosen)} outside [0, ${n}]`,
          });
        }
      }
    }

    if (divided && sa.targets.length > 0) {
      // Even split across targets (decision subsystem will customize).
      const perTarget = Math.floor(n / sa.targets.length);
      if (perTarget <= 0) return;
      for (const targetId of sa.targets) {
        yield* game.action.addCounter(targetId, counterType, perTarget, sa.sourceCardId);
      }
      return;
    }

    if (n <= 0) return;
    for (const targetId of sa.targets) {
      yield* game.action.addCounter(targetId, counterType, n, sa.sourceCardId);
    }
  }
}

effectRegistry.register(PutCounterEffect);
