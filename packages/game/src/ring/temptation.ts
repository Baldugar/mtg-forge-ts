// SPDX-License-Identifier: GPL-3.0-or-later
// CR 701.52 — "The Ring tempts you". On each temptation:
//   - The Ring's level for this player increments (clamped at 4).
//   - The player chooses a creature they control to be their Ring-bearer;
//     the chosen creature becomes (or remains) the bearer. If the player
//     controls no creatures the choice is skipped and the bearer stays
//     whatever it was (possibly null).
//   - Emits the RingTempted canonical event.
//
// After temptation, Task 63 recomputes the Ring-grant ledger so Layer 6
// ability grants follow the new level + bearer.
import type { EntityId, PlayerSeat } from "@mtg-forge-ts/core";
import { CardType, IllegalDecisionError, ZoneType, mkEvent } from "@mtg-forge-ts/core";
import type { EngineYield } from "../action/engine-yield.js";
import type { Game } from "../game.js";
import type { RingLevel, RingState } from "./ring-state.js";

// Level clamp — "at 4, stays 4". Written as a pure fn so the Task-68 test
// suite can verify the invariant directly without going through tempt().
export const incrementRingLevel = (l: RingLevel): RingLevel => (l >= 4 ? 4 : ((l + 1) as RingLevel));

export function* tempt(game: Game, seat: PlayerSeat): Generator<EngineYield, void, unknown> {
  const current = game.ringState.get(seat) ?? { bearer: null, level: 0 };
  const newLevel = incrementRingLevel(current.level);

  // Enumerate eligible bearer candidates: creatures the player controls
  // on the battlefield. CR 701.52c — the Ring-bearer must be a creature
  // you control. Non-creatures, opponent-controlled creatures, and
  // off-battlefield cards are excluded.
  const candidates: EntityId[] = [];
  for (const [id, card] of game.cards) {
    if (card.controllerSeat !== seat) continue;
    if (card.zone !== ZoneType.Battlefield) continue;
    const chars = game.layerEngine.computeCharacteristics(id);
    if (!chars.types.has(CardType.Creature)) continue;
    candidates.push(id);
  }

  let newBearer: EntityId | null = current.bearer;
  if (candidates.length > 0) {
    const response = (yield {
      kind: "decision",
      request: {
        kind: "chooseRingBearer",
        playerSeat: seat,
        candidateIds: candidates,
        currentBearer: current.bearer,
      },
    }) as { readonly kind: "chooseRingBearer"; readonly bearerId: EntityId | null };
    if (response.kind !== "chooseRingBearer") {
      throw new IllegalDecisionError(
        `tempt: expected chooseRingBearer response, got ${(response as { kind: string }).kind}`,
      );
    }
    if (response.bearerId !== null) {
      if (!candidates.includes(response.bearerId)) {
        throw new IllegalDecisionError(`chooseRingBearer: ${response.bearerId} not a valid candidate`);
      }
      newBearer = response.bearerId;
    } else if (current.bearer !== null && candidates.includes(current.bearer)) {
      // Null response + current bearer still among the candidates = keep.
      newBearer = current.bearer;
    } else {
      // Null response and no valid prior bearer: the bearer is "nothing".
      // This matches CR 701.52e (when the Ring-bearer leaves play the
      // player has no bearer until next temptation) — callers that want
      // to force a bearer must return a concrete id.
      newBearer = null;
    }
  } else {
    // No candidates — a player tempted with no creatures can't become
    // their own bearer. CR 701.52c: the bearer, if it exists, must
    // remain a creature you control; if you control none, the bearer
    // reverts to null.
    newBearer = null;
  }

  const next: RingState = { bearer: newBearer, level: newLevel };
  game.ringState.set(seat, next);
  // Task 63 (Milestone R second half) — re-evaluate the Ring-grant
  // ledger for this seat now that bearer/level may have changed. The
  // ledger owns the epoch bump so the next computeCharacteristics read
  // sees the new grants.
  game.ringGrantLedger.applyFor(game, seat);

  // CR 701.52 canonical event. The event payload (spec §8, locked at v1)
  // carries { playerSeat, cardId }; cardId is the NEW bearer's EntityId
  // or a sentinel 0-id when the bearer is null (event payload has no
  // "optional cardId" shape). Downstream consumers read game.ringState
  // directly for level + bearer nullness.
  yield game.emitEvent(
    mkEvent("RingTempted", game.turn, game.phase, {
      playerSeat: seat,
      cardId: newBearer ?? (0 as unknown as EntityId),
    }),
  );

  // Level change is a separately-observable transition so the RingLevel-
  // Changed event fires whenever a tempt actually moves the level dial.
  if (newLevel !== current.level) {
    yield game.emitEvent(
      mkEvent("RingLevelChanged", game.turn, game.phase, {
        playerSeat: seat,
        oldLevel: current.level,
        newLevel,
      }),
    );
  }
}
