// SPDX-License-Identifier: GPL-3.0-or-later
// Wave 11 — shared helpers for ReduceCost / RaiseCost / SetCost handlers.
//
// Each helper handles ONE Forge DSL gap that Wave 6 baseline left as a
// throw / ignore:
//   - parseMinManaParam : MinMana$ literal int.
//   - buildOnlyFirstSpellTracker : OnlyFirstSpell$ True per-turn fired guard.
//   - buildAmountResolver : Amount$ literal | X | Y | Z | SVar | Count$ exprs,
//     evaluated PER cast against current game state.
//   - parseAddSymbolsFromCost / parseSubtractSymbolsFromCost : Cost$-form
//     colored-pip raise / reduce (Alabaster Leech: Cost$ W).

import type { ManaSymbol, ParamValue, PlayerSeat, SVarAst } from "@mtg-forge-ts/core";
import { ManaCost } from "@mtg-forge-ts/core";
import type { Game } from "../../game.js";
import type { SvarContext } from "../../svar/context.js";
import { evaluateSVar } from "../../svar/evaluator.js";
import type { StaticHandlerCtx } from "../static-handler.js";
// Side-effect import: registers Number / Count / arithmetic / etc. selectors
// in the SVar registry so evaluateSVar can route Amount$ X / Count$Foo /
// Number$N expressions emitted by cost-mod statics.
import "../../svar/index.js";

const isLiteralRaw = (p: ParamValue | undefined): string | undefined =>
  p !== undefined && p.kind === "literal" ? p.raw : undefined;

// ---- MinMana$ -------------------------------------------------------------

export const parseMinManaParam = (p: ParamValue | undefined): number | undefined => {
  const raw = isLiteralRaw(p);
  if (raw === undefined) return undefined;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 0) return undefined;
  return n;
};

// ---- OnlyFirstSpell$ ------------------------------------------------------

export interface OnlyFirstSpellTracker {
  alreadyFired: (game: Game) => boolean;
  markUsed: (game: Game, item: unknown) => void;
}

/**
 * Returns null when OnlyFirstSpell$ is absent or non-True.
 *
 * The returned tracker holds a per-static, per-turn fired-state Map keyed by
 * (turnNumber, controllerSeat) of the cost-mod's source. `alreadyFired`
 * returns true if THIS static has fired against ANY cast for the static's
 * controller this turn. `markUsed` records the (turn, controllerSeat) so
 * subsequent casts the same turn skip this mod.
 *
 * The tracker's controllerSeat key is the static's source controllerSeat
 * (i.e. who controls the card emitting the static). This matches Forge's
 * "first spell each turn" — Forge's tracking is per-source, per-turn.
 */
export const buildOnlyFirstSpellTracker = (
  param: ParamValue | undefined,
  ctx: StaticHandlerCtx,
): OnlyFirstSpellTracker | null => {
  const raw = isLiteralRaw(param);
  if (raw === undefined) return null;
  if (raw !== "True" && raw !== "true") return null;
  const fired = new Map<string, true>();
  const seat = ctx.controllerSeat;
  const key = (turn: number): string => `${turn}::${seat}`;
  return {
    alreadyFired: (game: Game) => fired.has(key(game.turn)),
    markUsed: (game: Game) => {
      fired.set(key(game.turn), true);
    },
  };
};

// ---- Amount$ resolver -----------------------------------------------------

export type AmountResolver = (item: unknown, game: Game) => number;

/**
 * Build a per-cast amount resolver for Amount$. Supports:
 *   - literal numbers ("2", "3")
 *   - svarRef (X / Y / Z) — looks up the named SVar on the static's source
 *     card and evaluates it
 *   - inline expression (Count$..., Number$N) — evaluated directly
 *
 * Falls back to a constant 0 with a warning when the param is absent.
 *
 * Evaluation happens PER cast so dynamic counts (Domain, graveyard, hand
 * size, ...) reflect current game state rather than static creation time.
 */
export const buildAmountResolver = (
  param: ParamValue | undefined,
  svars: ReadonlyMap<string, SVarAst>,
  ctx: StaticHandlerCtx,
): AmountResolver => {
  if (param === undefined) {
    // Wave 6 baseline behaviour: missing Amount$ → "0" → no-op delta.
    return () => 0;
  }
  // Fast path: literal integer.
  if (param.kind === "literal") {
    const n = Number.parseInt(param.raw, 10);
    if (Number.isFinite(n)) {
      return () => n;
    }
    // Non-numeric literals (e.g. variable letter "X" tokenized as literal)
    // fall through to the dynamic evaluator path below.
  }

  // Dynamic path: build an SvarContext and evaluate per-cast.
  // Note: classifyParamValue would emit { kind: "svarRef", name: "X" } for
  // single-letter X/Y/Z, and { kind: "expression", ast } for Count$Foo. We
  // accept both.
  return (_item: unknown, game: Game) => {
    const svarCtx: SvarContext = {
      game,
      sourceCardId: ctx.sourceCardId,
      svars,
      controller: ctx.controllerSeat as PlayerSeat,
    };
    try {
      const v = evaluateSVar(param, svarCtx);
      if (typeof v !== "number") {
        // Defensive: a value-shaped SVar should resolve to a number.
        return 0;
      }
      return v;
    } catch {
      // SVar evaluator throws on unsupported expressions. Wave 12 added
      // Count$Domain support; remaining unsupported forms (e.g. Count$
      // <Valid<...>>) still fall through to 0 so the cost-mod stays inert
      // instead of crashing the cast pipeline.
      return 0;
    }
  };
};

// ---- Cost$ colored-pip add / subtract ------------------------------------

/**
 * Parse a Forge-style mana cost string (e.g. "W", "1 W", "2 R B") into the
 * list of individual ManaSymbol pips. Returns undefined if the param is
 * absent. Returns an empty array when the cost parses but has no symbols.
 *
 * Used by RaiseCost (addSymbols) and ReduceCost (subtractSymbols).
 */
const parseCostParamSymbols = (param: ParamValue | undefined): readonly ManaSymbol[] | undefined => {
  const raw = isLiteralRaw(param);
  if (raw === undefined) return undefined;
  // M6.82 — Forge's RaiseCost / ReduceCost Cost$ field can carry alt-cost
  // expressions (Discard<X/Creature/creature(s)>, Sac<1/Land>, tapXType<>,
  // BeholdExile<>, etc.) in addition to mana-symbol pips. Those are
  // additional non-mana costs that the cost modifier doesn't translate
  // into pip add/subtract; return [] so the apply side stays inert
  // for non-mana-only modifiers. Mana-symbol pips still parse normally.
  if (/<[^>]*\/[^>]*>/.test(raw) || /^[A-Za-z][A-Za-z]*</.test(raw)) {
    return [];
  }
  let parsed: ReturnType<typeof ManaCost.parse>;
  try {
    parsed = ManaCost.parse(raw);
  } catch {
    // Unrecognized cost-string token — defensive: yield no pip changes.
    return [];
  }
  // ManaCost.symbols is the canonical list including a generic-amount
  // symbol if present. We expand the generic symbol into N individual
  // generic-1 entries so the apply-side can subtract / add them
  // pip-by-pip uniformly.
  const out: ManaSymbol[] = [];
  for (const s of parsed.symbols) {
    if (s.kind === "generic") {
      // Keep as a single generic symbol — the apply side folds it into
      // the generic delta directly.
      out.push(s);
    } else {
      out.push(s);
    }
  }
  return out;
};

export const parseAddSymbolsFromCost = parseCostParamSymbols;
export const parseSubtractSymbolsFromCost = parseCostParamSymbols;
