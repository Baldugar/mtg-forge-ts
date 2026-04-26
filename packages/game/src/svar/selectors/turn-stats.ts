// SPDX-License-Identifier: GPL-3.0-or-later
// Wave 51 — per-turn / per-game stat Count$ selectors. Each reads from
// `game.flags`'s per-turn (or per-game) maps populated by the canonical
// mutators (drawCards, changeLife, surveil, addCounter/removeCounter,
// moveTo, noteSpellCast). Reset on TurnEnded by phase-handler for the
// "ThisTurn" forms; "LastTurn" forms read the snapshot taken at the
// previous TurnEnded.
//
// Per-controller forms read `ctx.controller`. Forms with no controller
// (e.g. evaluator invoked without a binding) return 0.
//
// Forms registered:
//   YouDrewThisTurn, LifeYouLostThisTurn, LifeYouGainedThisTurn,
//   LifeOppsLostThisTurn, ThisTurnCast, LastTurnCast, ThisTurnEntered,
//   LastTurnEntered, YouRolledThisTurn_<face>, YouFlipThisTurn,
//   YouSurveilThisTurn, YouCastThisGame, AttackersDeclared,
//   LeftBattlefieldThisTurn, LeftGraveyardThisTurn, CountersAddedThisTurn,
//   CountersRemovedThisTurn, UnlockedDoors, DistinctUnlockedDoors,
//   StormCount (alias for Count$Storm).
import type { PlayerSeat, SVarExpressionAst } from "@mtg-forge-ts/core";
import type { SvarContext } from "../context.js";
import { countArgRegistry } from "./count.js";

// --- Helpers ----------------------------------------------------------------

const opponentSeat = (seat: PlayerSeat): PlayerSeat => (1 - (seat as unknown as number)) as PlayerSeat;

// --- Per-turn (per-controller) ---------------------------------------------

const computeYouDrewThisTurn = (_ast: SVarExpressionAst, ctx: SvarContext): number => {
  if (ctx.controller === undefined) return 0;
  return ctx.game.flags.cardsDrawnThisTurn.get(ctx.controller) ?? 0;
};

const computeLifeYouLostThisTurn = (_ast: SVarExpressionAst, ctx: SvarContext): number => {
  if (ctx.controller === undefined) return 0;
  return ctx.game.flags.lifeLostThisTurn.get(ctx.controller) ?? 0;
};

const computeLifeYouGainedThisTurn = (_ast: SVarExpressionAst, ctx: SvarContext): number => {
  if (ctx.controller === undefined) return 0;
  return ctx.game.flags.lifeGainedThisTurn.get(ctx.controller) ?? 0;
};

// Sum of life lost by all opponents (Forge "your opponents" form). Two-
// player MVP — sums the single opponent's life-lost-this-turn entry.
const computeLifeOppsLostThisTurn = (_ast: SVarExpressionAst, ctx: SvarContext): number => {
  if (ctx.controller === undefined) return 0;
  let total = 0;
  for (const [seat, n] of ctx.game.flags.lifeLostThisTurn) {
    if (seat !== ctx.controller) total += n;
  }
  return total;
};

const computeThisTurnCast = (_ast: SVarExpressionAst, ctx: SvarContext): number => {
  if (ctx.controller === undefined) return 0;
  return ctx.game.flags.spellsCastThisTurn.get(ctx.controller) ?? 0;
};

const computeLastTurnCast = (_ast: SVarExpressionAst, ctx: SvarContext): number => {
  if (ctx.controller === undefined) return 0;
  return ctx.game.flags.lastTurnSpellsCast.get(ctx.controller) ?? 0;
};

const computeThisTurnEntered = (_ast: SVarExpressionAst, ctx: SvarContext): number => {
  if (ctx.controller === undefined) return 0;
  return ctx.game.flags.cardsEnteredThisTurn.get(ctx.controller) ?? 0;
};

const computeLastTurnEntered = (_ast: SVarExpressionAst, ctx: SvarContext): number => {
  if (ctx.controller === undefined) return 0;
  return ctx.game.flags.lastTurnCardsEntered.get(ctx.controller) ?? 0;
};

const computeYouFlipThisTurn = (_ast: SVarExpressionAst, ctx: SvarContext): number => {
  if (ctx.controller === undefined) return 0;
  return ctx.game.flags.flippedCoinsThisTurn.get(ctx.controller) ?? 0;
};

const computeYouSurveilThisTurn = (_ast: SVarExpressionAst, ctx: SvarContext): number => {
  if (ctx.controller === undefined) return 0;
  return ctx.game.flags.surveiledThisTurn.get(ctx.controller) ?? 0;
};

const computeYouCastThisGame = (_ast: SVarExpressionAst, ctx: SvarContext): number => {
  if (ctx.controller === undefined) return 0;
  return ctx.game.flags.spellsCastThisGame.get(ctx.controller) ?? 0;
};

const computeAttackersDeclared = (_ast: SVarExpressionAst, ctx: SvarContext): number => {
  if (ctx.controller === undefined) {
    // No controller — sum across all seats (Forge's "AttackersDeclared"
    // without a controller binding reads the global count).
    let total = 0;
    for (const n of ctx.game.flags.attackersDeclaredThisTurn.values()) total += n;
    return total;
  }
  return ctx.game.flags.attackersDeclaredThisTurn.get(ctx.controller) ?? 0;
};

const computeLeftBattlefieldThisTurn = (_ast: SVarExpressionAst, ctx: SvarContext): number => {
  // Global count — the Set tracks card ids regardless of controller. Cards
  // matter for the `LeftBattlefieldThisTurn` form.
  return ctx.game.flags.leftBattlefieldThisTurn.size;
};

const computeLeftGraveyardThisTurn = (_ast: SVarExpressionAst, ctx: SvarContext): number => {
  return ctx.game.flags.leftGraveyardThisTurn.size;
};

const computeCountersAddedThisTurn = (_ast: SVarExpressionAst, ctx: SvarContext): number => {
  // Sum across all cards. Forge's `Count$CountersAddedThisTurn` is the
  // "any counter on any permanent this turn" total (not per-card; the
  // per-card form is `CardCounters.<Type>`).
  let total = 0;
  for (const n of ctx.game.flags.countersAddedThisTurn.values()) total += n;
  return total;
};

const computeCountersRemovedThisTurn = (_ast: SVarExpressionAst, ctx: SvarContext): number => {
  return ctx.game.flags.countersRemovedThisTurn;
};

// Count$YouRolledThisTurn_<face> — per-face count of dice rolled this turn.
// Forge spells the face as a digit (1..N for d6/d20). Slot shape:
// `rolledDiceThisTurn.get(seat) → number[]`; we count occurrences of the
// requested face. Returns 0 when the face isn't a recognised integer.
const computeYouRolledThisTurn = (ast: SVarExpressionAst, ctx: SvarContext): number => {
  if (ctx.controller === undefined) return 0;
  const raw = ast.args?.[0]?.raw ?? "";
  // Form: "YouRolledThisTurn_<face>" — split on underscore.
  const us = raw.indexOf("_");
  if (us < 0) {
    // No face specified → total rolls this turn.
    const arr = ctx.game.flags.rolledDiceThisTurn.get(ctx.controller);
    return arr ? arr.length : 0;
  }
  const faceStr = raw.slice(us + 1);
  const face = Number.parseInt(faceStr, 10);
  if (!Number.isFinite(face)) return 0;
  const arr = ctx.game.flags.rolledDiceThisTurn.get(ctx.controller);
  if (!arr) return 0;
  let n = 0;
  for (const v of arr) if (v === face) n += 1;
  return n;
};

// Doors — TODO(advanced). Rooms (DSK / Doctor Who) carry an "unlocked"
// chapter-style state on the source card; tracking lives on a future Room
// subsystem. For MVP we read defensively from card slots; absent slots
// yield 0.
const computeUnlockedDoors = (_ast: SVarExpressionAst, ctx: SvarContext): number => {
  if (ctx.controller === undefined) return 0;
  let total = 0;
  for (const c of ctx.game.cards.values()) {
    if (c.controllerSeat !== ctx.controller) continue;
    const probe = c as unknown as { unlockedDoors?: number };
    if (typeof probe.unlockedDoors === "number") total += probe.unlockedDoors;
  }
  return total;
};

const computeDistinctUnlockedDoors = (_ast: SVarExpressionAst, ctx: SvarContext): number => {
  if (ctx.controller === undefined) return 0;
  // Distinct = number of cards with at least one unlocked door (rather
  // than the sum). TODO(advanced) once the Rooms primitive lands.
  let n = 0;
  for (const c of ctx.game.cards.values()) {
    if (c.controllerSeat !== ctx.controller) continue;
    const probe = c as unknown as { unlockedDoors?: number };
    if (typeof probe.unlockedDoors === "number" && probe.unlockedDoors > 0) n += 1;
  }
  return n;
};

// StormCount — alias for Count$Storm (CR 702.40 — total spells cast this
// turn before this one). Reuses Count$Storm's evaluator by re-implementing
// the read here so this module owns the alias entry.
const computeStormCount = (_ast: SVarExpressionAst, ctx: SvarContext): number => {
  if (ctx.controller === undefined) return 0;
  return ctx.game.flags.spellsCastThisTurn.get(ctx.controller) ?? 0;
};

countArgRegistry.register("YouDrewThisTurn", computeYouDrewThisTurn);
countArgRegistry.register("LifeYouLostThisTurn", computeLifeYouLostThisTurn);
countArgRegistry.register("LifeYouGainedThisTurn", computeLifeYouGainedThisTurn);
countArgRegistry.register("LifeOppsLostThisTurn", computeLifeOppsLostThisTurn);
countArgRegistry.register("ThisTurnCast", computeThisTurnCast);
countArgRegistry.register("LastTurnCast", computeLastTurnCast);
countArgRegistry.register("ThisTurnEntered", computeThisTurnEntered);
countArgRegistry.register("LastTurnEntered", computeLastTurnEntered);
countArgRegistry.register("YouFlipThisTurn", computeYouFlipThisTurn);
countArgRegistry.register("YouSurveilThisTurn", computeYouSurveilThisTurn);
countArgRegistry.register("YouCastThisGame", computeYouCastThisGame);
countArgRegistry.register("AttackersDeclared", computeAttackersDeclared);
countArgRegistry.register("LeftBattlefieldThisTurn", computeLeftBattlefieldThisTurn);
countArgRegistry.register("LeftGraveyardThisTurn", computeLeftGraveyardThisTurn);
countArgRegistry.register("CountersAddedThisTurn", computeCountersAddedThisTurn);
countArgRegistry.register("CountersRemovedThisTurn", computeCountersRemovedThisTurn);
countArgRegistry.register("YouRolledThisTurn", computeYouRolledThisTurn);
countArgRegistry.register("UnlockedDoors", computeUnlockedDoors);
countArgRegistry.register("DistinctUnlockedDoors", computeDistinctUnlockedDoors);
countArgRegistry.register("StormCount", computeStormCount);

// Mark `opponentSeat` as referenced — kept as documentation hook for the
// 2-player MVP path. Multi-opponent expansion (LifeOppsLostThisTurn 3+
// players) iterates the lifeLostThisTurn map directly above.
void opponentSeat;
