// SPDX-License-Identifier: GPL-3.0-or-later
// CR 702.150 — augment / host (Unstable). An augment card "combines"
// with a host creature on the battlefield to form a single permanent
// with merged characteristics. Unlike mutate (which stacks creatures
// into one pile), host+augment is strictly one augment per host, and
// the augment brings only a name fragment + an ability-granting clause.
//
// SP2 scope: the state-mutation primitive. Representation leans on the
// existing attachment subsystem (Milestone K) — the augment is
// structurally attached to the host via attachedTo / attachments, with
// a dedicated `isAugment` flag distinguishing it from Auras /
// Equipment. SP3's layer contributor consults the flag on Layer 4
// (type-changing) and Layer 6 (ability grants) to merge the augment's
// abilities / modified name into the host.
import type { EntityId } from "@mtg-forge-ts/core";
import { GameStateIntegrityError, mkEvent } from "@mtg-forge-ts/core";
import type { EngineYield } from "../action/engine-yield.js";
import type { Game } from "../game.js";

/**
 * Combine an augment with a host. The augment takes a back-seat on
 * the battlefield (still present as a Card, but `isAugment=true` and
 * structurally attached to the host); the host becomes the visible
 * merged permanent.
 *
 * Parameters mirror GameAction.attach: sourceId = augment, targetId =
 * host. The structural attachment invariants (source.attachedTo =
 * targetId, target.attachments.includes(sourceId)) are maintained
 * manually here — combine() bypasses the attach/replacement chain
 * because augment combination is a cast-resolve effect, not a
 * mutation the replacement registry intercepts.
 */
export function* combine(
  game: Game,
  hostId: EntityId,
  augmentId: EntityId,
): Generator<EngineYield, void, unknown> {
  const host = game.cards.get(hostId);
  const augment = game.cards.get(augmentId);
  if (!host || !augment) {
    throw new GameStateIntegrityError(`combine: card missing (${hostId}, ${augmentId})`);
  }
  if (hostId === augmentId) {
    throw new GameStateIntegrityError("combine: host and augment must differ");
  }
  augment.attachedTo = hostId;
  if (!host.attachments.includes(augmentId)) {
    host.attachments = [...host.attachments, augmentId];
  }
  augment.isAugment = true;
  game.layerEngine.bumpEpoch("combine-augment");
  yield {
    kind: "event",
    event: mkEvent("AttachmentChanged", game.turn, game.phase, {
      cardId: augmentId,
      newAttachedTo: hostId,
    }),
  };
}
