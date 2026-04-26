// SPDX-License-Identifier: GPL-3.0-or-later
// Day/Night auto-transition logic — Innistrad: Midnight Hunt; CR 726.4.
//
// Day/Night state lives at `Game.flags.dayNight: "day" | "night" | "neither"`.
// The state STARTS at "neither" and only enters the day/night cycle when a
// triggering card (a daybound/nightbound permanent ETB or a `SP$ DayTime`
// effect) seeds the state. Once seeded, two automatic transitions apply
// (CR 726.4):
//
//   1. At the START of each upkeep:
//      - If it is night and the previous turn's controller cast 2+ non-land
//        spells, it becomes day.
//      - If it is day and the previous turn's controller cast 0 non-land
//        spells, it becomes night.
//      Otherwise the state is unchanged. Both transitions emit
//      DayTimeChanged.
//
//   2. The "becomes day if a player is about to take their turn while the
//      state is neither" rule (CR 726.3) is also encoded — but this wave
//      ONLY fires when an external mechanism has already promoted the state
//      out of "neither" (we never auto-set on a vanilla game). This matches
//      Forge's behavior: dayNight is dormant until the first triggering
//      card touches it.
//
// The tracker is a small set of pure helpers — phase-handler.ts calls them
// at upkeep start, and cast-pipeline.ts calls noteSpellCast when a non-land
// spell finalizes onto the stack.
import type { PlayerSeat } from "@mtg-forge-ts/core";
import { CardType } from "@mtg-forge-ts/core";
import type { Game } from "../game.js";

/**
 * Increment the per-turn non-land spell count for `seat`. Called by the
 * cast pipeline AFTER finalizeStackItem when a spell has been pushed onto
 * the stack (so the cast actually happened — abort paths don't count).
 * Lands are skipped per CR 726.4 wording ("non-land spells").
 */
export const noteSpellCast = (game: Game, seat: PlayerSeat, sourceCardId: number): void => {
  const card = game.cards.get(sourceCardId as Parameters<Game["cards"]["get"]>[0]);
  if (!card) return;
  // Use computeCharacteristics so type-changing effects (e.g. animated
  // lands cast as creatures via a continuous effect — rare but legal in
  // future formats) read the layered final type, not the printed face.
  const chars = game.layerEngine.computeCharacteristics(card.id);
  if (chars.types.has(CardType.Land)) return;
  const prior = game.flags.spellsCastThisTurn.get(seat) ?? 0;
  game.flags.spellsCastThisTurn.set(seat, prior + 1);
};

/**
 * Snapshot the current turn's spell-cast counts onto `lastTurnSpellsCast`
 * and reset the live counter. Called from PhaseHandler at TurnEnded so the
 * NEXT turn's upkeep transition can read "previous turn's controller's
 * count". Also stamps lastTurnActiveSeat with whose turn just ended.
 */
export const noteTurnEnd = (game: Game, activeSeat: PlayerSeat): void => {
  game.flags.lastTurnSpellsCast.clear();
  for (const [seat, count] of game.flags.spellsCastThisTurn) {
    game.flags.lastTurnSpellsCast.set(seat, count);
  }
  game.flags.spellsCastThisTurn.clear();
  game.flags.lastTurnActiveSeat = activeSeat;
};

/**
 * Run the upkeep auto-transition (CR 726.4). Reads
 * `flags.lastTurnSpellsCast[lastTurnActiveSeat]` and flips dayNight if the
 * conditions match. Returns the emitted GameEvent if a transition fired so
 * the caller can yield it through the engine pipeline; otherwise null.
 *
 * Pitfall: this is a no-op while dayNight === "neither" — the rule only
 * applies once the state has been seeded by a triggering card (CR 726.3).
 */
export const tryUpkeepTransition = (
  game: Game,
): {
  oldValue: "day" | "night" | "neither";
  newValue: "day" | "night" | "neither";
} | null => {
  const cur = game.flags.dayNight;
  if (cur === "neither") return null;
  const prevSeat = game.flags.lastTurnActiveSeat;
  if (prevSeat === null) return null;
  const prevSpellCount = game.flags.lastTurnSpellsCast.get(prevSeat) ?? 0;
  let next: "day" | "night" | "neither" = cur;
  if (cur === "night" && prevSpellCount >= 2) next = "day";
  else if (cur === "day" && prevSpellCount === 0) next = "night";
  if (next === cur) return null;
  game.flags.dayNight = next;
  return { oldValue: cur, newValue: next };
};
