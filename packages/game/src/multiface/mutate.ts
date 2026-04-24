// SPDX-License-Identifier: GPL-3.0-or-later
// CR 702.157 — mutate. An Ikoria mechanic that stacks creatures atop a
// host. The resulting permanent is a single game object; its name, P/T,
// and characteristic-defining abilities come from the topmost card in
// the pile, while abilities from every other card in the pile are
// unioned onto the top.
//
// SP2 scope: the state-mutation primitive. The runtime carries the
// pile order on Card.mutatedPile (top-to-bottom; index 0 is topmost);
// non-primary pile members carry `mutatedInto` pointing at the host
// slot they merged into. SP3's rules DSL consumes this structure to
// drive the characteristic union (which lives on Layer 6 for ability
// grants); SP2 only tracks the bookkeeping + emits a state-change
// observation via AttachmentChanged.
//
// Design choice — reusing AttachmentChanged: meld/mutate/augment are
// all structural attach/combine operations and Milestone K (attachment)
// already owns the "parent-child graph changed" observable. Rather
// than add three new event kinds for variations on the same thing,
// the primitives emit AttachmentChanged with distinct meanings
// encoded via the cardId (host) / oldAttachedTo / newAttachedTo slots.
import type { EntityId } from "@mtg-forge-ts/core";
import { GameStateIntegrityError, mkEvent } from "@mtg-forge-ts/core";
import type { EngineYield } from "../action/engine-yield.js";
import type { Game } from "../game.js";

/**
 * Mutate a creature into the host's pile. `placeOnTop === true` puts
 * the mutator at index 0 (new topmost = new defining face); false
 * appends beneath the existing pile.
 *
 * Side effects:
 *   • host.mutatedPile grows by one; includes hostId at the bottom on
 *     first mutation so the pile always carries the full merged stack.
 *   • mutator.mutatedInto = hostId so SBAs and zone-change handlers
 *     know the mutator is no longer independent.
 *   • Layer epoch bumps — characteristic-defining reads against the
 *     new top need to pick up the change.
 *   • Emits `AttachmentChanged` with cardId=mutatorId +
 *     newAttachedTo=hostId; SP3 expands the event family if a
 *     dedicated `Mutated` becomes necessary.
 */
export function* mutate(
  game: Game,
  hostId: EntityId,
  mutatorId: EntityId,
  placeOnTop: boolean,
): Generator<EngineYield, void, unknown> {
  const host = game.cards.get(hostId);
  const mutator = game.cards.get(mutatorId);
  if (!host || !mutator) {
    throw new GameStateIntegrityError(`mutate: card missing (${hostId}, ${mutatorId})`);
  }
  if (hostId === mutatorId) {
    throw new GameStateIntegrityError("mutate: host and mutator must differ");
  }
  // First mutation seeds the pile with the host id at the bottom; that
  // way `mutatedPile` on the host always fully reconstructs the merged
  // stack (top-to-bottom) without a special case for "just the host".
  const existing = host.mutatedPile;
  const seeded: readonly EntityId[] = existing === undefined ? [hostId] : existing;
  const pile: readonly EntityId[] = placeOnTop ? [mutatorId, ...seeded] : [...seeded, mutatorId];
  host.mutatedPile = pile;
  mutator.mutatedInto = hostId;
  game.layerEngine.bumpEpoch("mutate");
  yield {
    kind: "event",
    event: mkEvent("AttachmentChanged", game.turn, game.phase, {
      cardId: mutatorId,
      newAttachedTo: hostId,
    }),
  };
}
