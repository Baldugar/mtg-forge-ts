// SPDX-License-Identifier: GPL-3.0-or-later
// Convenience wrappers for evaluating AbilityAst effect parameters via the
// SVar evaluator. The SpellAbility carries its own svars map so no Game
// round-trip is needed.
import type { Game } from "../game.js";
import { type SvarContext, evaluateSVar } from "../svar/index.js";
import type { SpellAbility } from "./spell-ability.js";

const buildCtx = (sa: SpellAbility, game: Game): SvarContext => ({
  game,
  sourceCardId: sa.sourceCardId,
  svars: sa.svars,
  controller: sa.controllerSeat,
  targets: sa.targets,
  ...(sa.xValue !== undefined ? { xValue: sa.xValue } : {}),
});

export const evaluateParamNumber = (sa: SpellAbility, key: string, game: Game): number => {
  const pv = sa.ast.effect.params[key];
  if (!pv) throw new Error(`evaluateParamNumber: no param '${key}' on ${sa.handlerKey}`);
  const result = evaluateSVar(pv, buildCtx(sa, game));
  if (typeof result !== "number") {
    throw new Error(`evaluateParamNumber: param '${key}' did not evaluate to a number`);
  }
  return result;
};

export const evaluateParamRaw = (sa: SpellAbility, key: string): string => {
  const pv = sa.ast.effect.params[key];
  if (!pv) throw new Error(`evaluateParamRaw: no param '${key}' on ${sa.handlerKey}`);
  if (pv.kind === "literal") return pv.raw;
  // M6.16 — Some params (RepeatSubAbility$ DBReveal, AbilityName$ DBFoo,
  // SubAbility$ DBBar) carry a SVar/sub-ability name as the raw value;
  // the parser tags single-letter X/Y/Z and DB-prefixed names as
  // 'svarRef' even when the param key wants the bare name. Allow that
  // form to pass through as the SVar reference name — callers expect
  // the printed text and look the SVar up themselves.
  if (pv.kind === "svarRef") return pv.name;
  // Likewise expressions that didn't classify cleanly (e.g. "All", "X-1")
  // — surface the raw text so consumers can do their own parsing.
  if (pv.kind === "expression") return pv.ast.raw ?? "";
  throw new Error(
    `evaluateParamRaw: param '${key}' kind is '${(pv as { kind: string }).kind}', not 'literal'`,
  );
};

export const hasParam = (sa: SpellAbility, key: string): boolean => key in sa.ast.effect.params;
