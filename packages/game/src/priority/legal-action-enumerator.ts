// SPDX-License-Identifier: GPL-3.0-or-later
// CR 116 / CR 117 — enumerate the legal PriorityActions a player may take
// while holding priority. The priority orchestrator (Task 40) attaches the
// returned list to the `priority` DecisionRequest so controllers see the
// exact action set they may respond with.
//
// SP2 scope:
//   - `pass`: always legal (CR 117.4 — a player may always pass priority).
//   - `castSpell(cardId, zone)`: card is in hand, timing permits (sorcery
//     speed vs instant speed), and no `cantCast` restriction applies.
//   - `playLand(cardId)`: CR 305.1 / 116.2a — special action, only legal
//     during the active player's own main phase, with an empty stack, and
//     only while they are under their per-turn land limit (default 1 via
//     GameFlags.landsPlayedThisTurn).
//   - `activateAbility(abilityInstanceId)`: stubbed — SP2 has no concrete
//     activated abilities yet (no DSL-produced activated shapes). Task 41
//     exposes the enumerator entry point; the activated branch lights up in
//     SP3 when the DSL lands real activated-ability records. Mana abilities
//     (CR 605.3) activate OUTSIDE priority windows and are intentionally
//     omitted here.
//
// Restrictions are consulted via isRestricted() (the cant-must-may facility
// from Task 28). Format restrictions + alternative casting zones (flashback,
// escape, adventure-from-exile, etc.) land in SP3's cast-surface expansion.
import type { PlayerSeat, PriorityAction } from "@mtg-forge-ts/core";
import { CardType, PhaseStep, ZoneType } from "@mtg-forge-ts/core";
import type { Game } from "../game.js";
import { isRestricted } from "../statics/cant-must-may.js";

/**
 * True when the game is in a main phase AND the stack is empty. This is the
 * timing gate for sorcery-speed casts and for the "play a land" special
 * action (CR 116.2a, 307.1). Not factoring in active-player-ness here — the
 * orchestrator only invokes this enumerator for the priority-holder, which
 * at sorcery speed must already be the active player.
 */
const isMainPhaseEmptyStack = (game: Game): boolean => {
  const stackEmpty = game.sharedZones.stack.isEmpty();
  const inMain = game.phase === PhaseStep.Main1 || game.phase === PhaseStep.Main2;
  return stackEmpty && inMain;
};

/**
 * True when the player still has a land-drop available this turn. SP2 uses
 * the standard default (1 land per turn — CR 305.2); future work in
 * Milestone S (turn sequence) ties land-per-turn increments from "may play
 * an additional land" effects into this check. For SP2 we read
 * GameFlags.landsPlayedThisTurn, defaulting to 0 when the seat has no entry
 * (first land-drop of the turn).
 */
const canPlayLandNow = (game: Game, seat: PlayerSeat): boolean => {
  // SP2 gates strictly on the active player: CR 305.1 — a player can only
  // play a land during their own turn.
  if (game.activePlayer !== seat) return false;
  const playedSoFar = game.flags.landsPlayedThisTurn.get(seat) ?? 0;
  // SP2 SIMPLIFICATION: hardcoded 1-land-per-turn. Extra-land-drop effects
  // ("Azusa, Lost but Seeking", "Exploration") are wired when Milestone S
  // introduces per-turn land-drop max tracking (game-flags or dedicated
  // field); until then, we trip after a single drop.
  return playedSoFar < 1;
};

/**
 * Timing-only check for spells. Instants (and anything with flash, SP3)
 * may be cast any time a player has priority; everything else requires
 * sorcery speed (CR 307.1 / 117.1a) — main phase of the caster's own turn
 * with an empty stack. Active-player gating is already handled upstream:
 * the orchestrator only invokes this enumerator for the priority holder,
 * who at sorcery speed is the active player by construction.
 */
const canCastAtCurrentTiming = (
  game: Game,
  chars: { readonly types: ReadonlySet<CardType> },
  seat: PlayerSeat,
): boolean => {
  if (chars.types.has(CardType.Instant)) return true;
  // SP3 adds flash-keyword detection; SP2 treats every non-instant as
  // sorcery-speed and additionally gates on active-player-main-empty-stack.
  if (game.activePlayer !== seat) return false;
  return isMainPhaseEmptyStack(game);
};

/**
 * Enumerate the legal PriorityActions the given player may take during a
 * priority window. Returns a deterministically-ordered list:
 *   1. `pass` always first.
 *   2. Hand cards in zone order: castable spells then playable lands.
 *   3. Activated abilities of controlled permanents (SP2 stub — returns no
 *      entries until SP3 lands activated-ability shapes).
 */
export const enumerateLegalActions = (game: Game, seat: PlayerSeat): readonly PriorityAction[] => {
  const out: PriorityAction[] = [{ kind: "pass" }];

  const player = game.players.find((p) => p.seat === seat);
  if (!player) return out;

  const hand = player.zones.get(ZoneType.Hand);
  if (hand) {
    for (const cardId of hand.toArray()) {
      const card = game.cards.get(cardId);
      if (!card) continue;
      const chars = game.layerEngine.computeCharacteristics(cardId);
      // Lands are special-action territory, not spells.
      if (chars.types.has(CardType.Land)) {
        if (isMainPhaseEmptyStack(game) && canPlayLandNow(game, seat)) {
          out.push({ kind: "playLand", cardId });
        }
        continue;
      }
      if (!canCastAtCurrentTiming(game, chars, seat)) continue;
      if (isRestricted(game, "cantCast", cardId)) continue;
      out.push({ kind: "castSpell", cardId, zone: ZoneType.Hand });
    }
  }

  // Activated abilities on controlled permanents — SP2 stub.
  //
  // The SP2 Characteristics.abilities list carries ActiveAbilityRef entries
  // whose kind (activated vs triggered vs static) isn't resolvable until
  // SP3's DSL mints concrete ability records. Emitting entries blindly here
  // would poison the engine's decision validator, so we deliberately skip
  // the branch and document the SP3 reconnection point instead.
  //
  // SP3 WIRING: iterate battlefield; for each permanent `seat` controls,
  // resolve each ability ref against a registry of activated-ability shapes;
  // for each one whose timing + cost + restriction gates pass, push
  // `{ kind: "activateAbility", abilityInstanceId }`. Mana abilities are
  // still excluded from this list (CR 605.3 activates outside priority).
  const battlefield = player.zones.get(ZoneType.Battlefield);
  if (battlefield) {
    // Touch the zone so future SP3 wiring has a visible attach point; no-op
    // in SP2.
    void battlefield;
  }

  return out;
};
