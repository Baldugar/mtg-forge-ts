// SPDX-License-Identifier: GPL-3.0-or-later
// CR 702.26 — Phasing.
//
// Phased-out permanents stay on the battlefield for engine-internal purposes
// but become invisible to most effects (CR 702.26e): targeting skips them,
// triggers don't fire from them, they don't receive damage, they don't
// untap, they can't attack/block.
//
// Phasing transitions happen at the start of the controller's untap step
// (CR 702.26d). The per-turn driver `processPhasingOnUntap` toggles each
// permanent the active player controls:
//   - Permanents the active player controls with the phasing keyword phase
//     out (if currently phased-in) or phase in (if currently phased-out).
//   - A phased-out permanent whose phase-out effect has ended (tracked via
//     `phased === true` regardless of keyword, since SP2 doesn't yet track
//     the "effect ended" flag separately) phases in.
//
// `phaseOut` and `phaseIn` are the primitive mutators. SP3 will wire the
// canonical replacement chain around them when "if a permanent would phase
// out" replacements land; for now they mutate directly and emit events.
//
// Zone change: moving a phased-out card off the battlefield resets the
// `phased` flag as part of the move. Semantically the card phases in first
// then changes zones — we flip the flag without emitting PhasedIn because
// the card is leaving the "phased-out on the battlefield" state by virtue
// of no longer being on the battlefield at all (CR 702.26g indirectly).
import type { EntityId, PlayerSeat } from "@mtg-forge-ts/core";
import { ZoneType, mkEvent } from "@mtg-forge-ts/core";
import type { EngineYield } from "../action/engine-yield.js";
import { hasKeyword, isPhasedOut } from "../combat/damage-assignment-helpers.js";
import type { Game } from "../game.js";
import { canPhaseIn, canPhaseOut } from "../statics/wave70o-gate-helpers.js";

export function* phaseOut(
  game: Game,
  cardId: EntityId,
  opts?: { readonly direct?: boolean },
): Generator<EngineYield, void, unknown> {
  const card = game.cards.get(cardId);
  if (!card) return;
  if (card.phased) return;
  // Wave 70.O — CR 702.26 CantPhaseOut static gate. When any active
  // CantPhaseOut static matches the card, the transition no-ops silently
  // — no PhasedOut event is emitted.
  if (!canPhaseOut(game, cardId)) return;
  card.phased = true;
  game.layerEngine.bumpEpoch("phase-out");
  yield {
    kind: "event",
    event: mkEvent("PhasedOut", game.turn, game.phase, {
      cardId,
      direct: opts?.direct ?? false,
    }),
  };
}

export function* phaseIn(
  game: Game,
  cardId: EntityId,
  opts?: { readonly direct?: boolean },
): Generator<EngineYield, void, unknown> {
  const card = game.cards.get(cardId);
  if (!card) return;
  // Wave 54 — accept either of the two phased-out flags. `card.phased` is
  // the keyword-Phasing flag; `card.phasedOut` is the `SP$ Phases` (Teferi's
  // Veil / Tawnos's Coffin) flag. CR 702.26d treats both states identically
  // for phase-in purposes, so we reset both here.
  if (!card.phased && !card.phasedOut) return;
  // Wave 70.O — CR 702.26 CantPhaseIn static gate. When any active
  // CantPhaseIn static matches the card, the transition no-ops silently
  // — the card stays phased out, no PhasedIn event is emitted.
  if (!canPhaseIn(game, cardId)) return;
  card.phased = false;
  card.phasedOut = false;
  game.layerEngine.bumpEpoch("phase-in");
  yield {
    kind: "event",
    event: mkEvent("PhasedIn", game.turn, game.phase, {
      cardId,
      direct: opts?.direct ?? false,
    }),
  };
}

/**
 * CR 702.26d — at the start of each player's untap step, every permanent
 * that player controls with phasing phases out, and every phased-out
 * permanent owned or controlled by that player phases in.
 *
 * SP2 simplification: we treat "controlled by the active player" for both
 * the phase-out and phase-in halves. CR's fine-grained "owned or controlled"
 * distinction matters for cards that changed controllers while phased out;
 * SP3's control-ledger integration will revisit. Phase-in takes priority
 * over phase-out on the same tick (a permanent can't both phase in and
 * phase out in the same step per CR 702.26d wording).
 */
export function* processPhasingOnUntap(
  game: Game,
  activeSeat: PlayerSeat,
): Generator<EngineYield, void, unknown> {
  const toPhaseIn: EntityId[] = [];
  const toPhaseOut: EntityId[] = [];
  for (const [id, card] of game.cards) {
    if (card.controllerSeat !== activeSeat) continue;
    if (card.zone !== ZoneType.Battlefield) continue;
    if (isPhasedOut(game, id)) {
      toPhaseIn.push(id);
    } else if (hasKeyword(game, id, "phasing")) {
      toPhaseOut.push(id);
    }
  }
  // Phase-in first, then phase-out (so a freshly-phased-in permanent with
  // the phasing keyword doesn't immediately phase out on the same step).
  for (const id of toPhaseIn) {
    yield* phaseIn(game, id);
  }
  for (const id of toPhaseOut) {
    yield* phaseOut(game, id);
  }
}
