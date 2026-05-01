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
// Wave 87 — RepeatPresent$ / RepeatSVarCompare$ continuation predicates.
// Both forms are evaluated BEFORE each iteration; once the predicate fails,
// the repeat halts. The Forge corpus pattern is "until you no longer
// control X" / "until SVar Y reaches N".
//
// `RepeatPresent$ <ValidCard>` — keep iterating while at least one
// battlefield card matches the (lightweight) ValidCard filter. Supported
// today: bare base type (`Creature`, `Artifact`, …), subtype names
// (`Goblin`, `Swamp`), and the `.YouCtrl` / `.OppCtrl` / `.Self` quals
// that the trigger always-matcher (Wave 14b) handles. Unrecognised
// qualifiers fall through as truthy (don't over-stop the repeat).
//
// `RepeatSVarCompare$ <SVar> <op> <N>` — keep iterating while the printed
// SVar's numeric value satisfies the comparison. Operators: `EQ`, `NE`,
// `LT`, `LE`, `GT`, `GE`. SVar lookup goes through `sa.svars`. The SVar
// must be a literal/number-shaped entry; ability-shaped SVars are treated
// as `0` (the conservative "never satisfies" default).
import { CardType, ZoneType } from "@mtg-forge-ts/core";
import type { AbilityAst, DecisionResponse, EntityId } from "@mtg-forge-ts/core";
import type { EngineYield } from "../../action/engine-yield.js";
import type { Card } from "../../card.js";
import type { Game } from "../../game.js";
import { effectRegistry } from "../effect-registry.js";
import { evaluateParamNumber, evaluateParamRaw, hasParam } from "../evaluate-param.js";
import { SpellAbilityEffect } from "../spell-ability-effect.js";
import { SpellAbility } from "../spell-ability.js";

const HARD_CAP = 100;

// Lightweight ValidCard matcher — base-type / subtype + .YouCtrl /
// .OppCtrl / .Self / .tapped / .untapped quals. Mirrors the trigger
// always-matcher's surface but stays local to keep this file self-
// contained (the trigger module isn't a dependency of effects). On
// unrecognised qualifiers we conservatively accept so the repeat
// doesn't halt prematurely on cards the printed text would include.
const cardMatchesPresent = (
  card: Card,
  raw: string,
  controllerSeat: import("@mtg-forge-ts/core").PlayerSeat,
  selfId: EntityId,
): boolean => {
  if (raw.length === 0) return true;
  const parts = raw.split(".");
  const base = parts[0] ?? "Card";
  const def = card.paperCard.definition;
  switch (base) {
    case "Card":
    case "Permanent":
      break;
    case "Creature":
      if (!def?.types?.has(CardType.Creature)) return false;
      break;
    case "Artifact":
      if (!def?.types?.has(CardType.Artifact)) return false;
      break;
    case "Enchantment":
      if (!def?.types?.has(CardType.Enchantment)) return false;
      break;
    case "Land":
      if (!def?.types?.has(CardType.Land)) return false;
      break;
    case "Instant":
      if (!def?.types?.has(CardType.Instant)) return false;
      break;
    case "Sorcery":
      if (!def?.types?.has(CardType.Sorcery)) return false;
      break;
    case "Planeswalker":
      if (!def?.types?.has(CardType.Planeswalker)) return false;
      break;
    default: {
      // Subtype branch — check the printed subtypes list. Forge's
      // ValidCard grammar treats subtype names case-sensitively; the
      // TypeLine preserves printed casing.
      const subs = def?.types?.subtypes;
      if (!subs || !subs.includes(base)) return false;
      break;
    }
  }
  for (const q of parts.slice(1)) {
    if (q === "Self") {
      if (card.id !== selfId) return false;
      continue;
    }
    if (q === "YouCtrl") {
      if (card.controllerSeat !== controllerSeat) return false;
      continue;
    }
    if (q === "OppCtrl" || q === "OpponentCtrl") {
      if (card.controllerSeat === controllerSeat) return false;
      continue;
    }
    if (q === "tapped") {
      if (!card.tapped) return false;
      continue;
    }
    if (q === "untapped") {
      if (card.tapped) return false;
    }
    // Unrecognised — accept (conservative — keep iterating).
  }
  return true;
};

const presentSatisfied = (
  raw: string,
  game: Game,
  controllerSeat: import("@mtg-forge-ts/core").PlayerSeat,
  selfId: EntityId,
): boolean => {
  for (const card of game.cards.values()) {
    if (card.zone !== ZoneType.Battlefield) continue;
    if (cardMatchesPresent(card, raw, controllerSeat, selfId)) return true;
  }
  return false;
};

const COMPARE_OP = /^(EQ|NE|LT|LE|GT|GE)\s+(-?\d+)\s*$/i;

const evalCompare = (lhs: number, op: string, rhs: number): boolean => {
  switch (op.toUpperCase()) {
    case "EQ":
      return lhs === rhs;
    case "NE":
      return lhs !== rhs;
    case "LT":
      return lhs < rhs;
    case "LE":
      return lhs <= rhs;
    case "GT":
      return lhs > rhs;
    case "GE":
      return lhs >= rhs;
    default:
      return false;
  }
};

const svarSatisfied = (raw: string, sa: SpellAbility, game: Game): boolean => {
  // Format: `<SVarName> <OP> <N>`. The SVar name resolves through
  // `sa.svars`; numeric value pulls from a literal/number entry. Ability
  // SVars and missing entries default to 0.
  const trimmed = raw.trim();
  const idxSpace = trimmed.indexOf(" ");
  if (idxSpace < 0) return false;
  const svarName = trimmed.slice(0, idxSpace);
  const tail = trimmed.slice(idxSpace + 1).trim();
  const m = COMPARE_OP.exec(tail);
  if (!m) return false;
  const op = m[1];
  const rhsRaw = m[2];
  if (op === undefined || rhsRaw === undefined) return false;
  const rhs = Number.parseInt(rhsRaw, 10);
  if (!Number.isFinite(rhs)) return false;
  let lhs = 0;
  const sv = sa.svars.get(svarName);
  if (sv) {
    // SVarAst.raw carries the printed expression text. For Repeat
    // continuation the canonical Forge corpus stores integer literals
    // ("Number$ 3" / "0") in `raw`; we accept any base-10 integer that
    // parses cleanly. Ability / trigger / replacement / static SVars
    // are non-numeric and default to 0 (the "never satisfies" default
    // for continuation tests).
    const parsed = Number.parseInt(sv.raw, 10);
    if (Number.isFinite(parsed)) lhs = parsed;
  }
  void game;
  return evalCompare(lhs, op, rhs);
};

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
    // Wave 87 — continuation predicates. RepeatPresent$ keeps iterating
    // while a battlefield card matches the filter; RepeatSVarCompare$
    // keeps iterating while the named SVar's int value satisfies the
    // comparison. When neither is set the legacy behaviour (fixed cap)
    // applies. Both are evaluated BEFORE each iteration: the loop halts
    // as soon as the predicate stops holding (mirrors Forge's "until
    // you no longer X" continuation form).
    const presentRaw = hasParam(sa, "RepeatPresent") ? evaluateParamRaw(sa, "RepeatPresent") : "";
    const compareRaw = hasParam(sa, "RepeatSVarCompare") ? evaluateParamRaw(sa, "RepeatSVarCompare") : "";
    const hasContinuation = presentRaw.length > 0 || compareRaw.length > 0;
    const checkContinuation = (): boolean => {
      if (presentRaw.length > 0 && !presentSatisfied(presentRaw, game, sa.controllerSeat, sa.sourceCardId)) {
        return false;
      }
      if (compareRaw.length > 0 && !svarSatisfied(compareRaw, sa, game)) {
        return false;
      }
      return true;
    };

    if (!optional) {
      // Fixed iteration count, optionally gated by continuation. When
      // continuation is set, run UP TO HARD_CAP iterations but halt as
      // soon as the predicate fails. Without continuation, the legacy
      // fixed-count loop (capped at maxRepeat) applies.
      const limit = hasContinuation ? HARD_CAP : cap;
      for (let i = 0; i < limit; i++) {
        if (hasContinuation && !checkContinuation()) break;
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
      // Continuation predicates short-circuit the prompt: when the
      // predicate fails we stop without asking (matches Forge — the
      // ability has no further legal effect).
      if (hasContinuation && !checkContinuation()) break;
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
