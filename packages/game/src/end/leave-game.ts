// SPDX-License-Identifier: GPL-3.0-or-later
// SP2 Milestone L Task 45 — CR 800.4 player-leaves-game cleanup.
//
// When a player leaves the game:
//   800.4a  All objects owned by the leaving player leave the game
//           simultaneously. Other players gain control of any objects
//           they own that the leaver currently controls.
//   800.4b  All spells and abilities controlled by the leaving player
//           on the stack cease to exist.
//   800.4c  Any continuous effects the leaving player controls end.
//
// This helper runs as a generator so control-reversion and zone-removals
// flow through GameAction (replacements / triggers see them). The call
// site is SbaEngine's loss pipeline (after markPlayerLost sets the
// terminal-state flag).
//
// SP2 minimal scope: we implement the three rule-driven cleanups
// directly. The continuous-effect "controlled by leaver" cleanup
// consults ContinuousEffectRegistry and unregisters by sourceCardId
// owner — an effect's controller follows its source's controller.
// Stack removal is a simple filter over StackItem.controllerSeat.
//
// Forge reference: GameAction.concede / GameAction.leaveGame drive
// essentially this logic; our split between Game.emitEvent / this
// helper mirrors theirs.
import type { EntityId, PlayerSeat } from "@mtg-forge-ts/core";
import type { EngineYield } from "../action/engine-yield.js";
import type { Game } from "../game.js";

export function* removePlayerFromGame(game: Game, seat: PlayerSeat): Generator<EngineYield, void, unknown> {
  // Step 1 (800.4a, second sentence) — return control of objects the
  // leaver controls but does NOT own. We do this FIRST so the
  // subsequent owner-based removal doesn't accidentally skip these
  // cards (they remain in the game because they're owned by someone
  // else). changeControl routes through the replacement pipeline.
  const toReturnControl: Array<{ id: EntityId; to: PlayerSeat }> = [];
  for (const [id, card] of game.cards) {
    if (card.controllerSeat === seat && card.ownerSeat !== seat) {
      toReturnControl.push({ id, to: card.ownerSeat });
    }
  }
  for (const { id, to } of toReturnControl) {
    yield* game.action.changeControl(id, to);
  }

  // Step 2 (800.4a, first sentence) — remove every object owned by the
  // leaving player from the game. We walk cards + every zone the card
  // could inhabit, removing by entity id.
  //
  // WHY: collect ids first, then iterate — mutating the cards Map while
  // iterating is unsafe (insertion-order traversal with concurrent
  // deletion is JavaScript-legal but fragile across engines).
  const ownedIds: EntityId[] = [];
  for (const [id, card] of game.cards) {
    if (card.ownerSeat === seat) ownedIds.push(id);
  }
  for (const id of ownedIds) {
    removeFromAllZones(game, id);
    // Also scrub any aura-grant ledger entry for this card — otherwise
    // the ledger holds dangling Layer 6 effects pointing at non-existent
    // ability ids.
    game.auraGrantLedger.onUnattach(game, id);
    game.cards.delete(id);
  }

  // Step 3 (800.4b) — drop every stack item the leaver controls. This
  // includes spell casts, activated abilities, triggered abilities, and
  // copies. StackItem exposes an ordered items array; we rebuild it by
  // filtering out leaver-controlled entries.
  clearLeaverStackItems(game, seat);

  // Step 4 (800.4c) — expire continuous effects controlled by the
  // leaver. An effect's controller is the controller of its source
  // card at registration time — since the source card just left the
  // game, the registry's layerEngine/abilityEffects references are
  // stale anyway. We walk the registry and unregister any effect whose
  // sourceCardId is no longer in game.cards.
  expireLeaverContinuousEffects(game);

  // Final: layer engine cache invalidation. Every mutation path above
  // bumped epoch incrementally; a final bump guarantees callers
  // reading characteristics after the leave see the post-cleanup view.
  game.layerEngine.bumpEpoch("player-left-game");
}

const removeFromAllZones = (game: Game, cardId: EntityId): void => {
  for (const player of game.players) {
    for (const zone of player.zones.values()) {
      if (zone.contains(cardId)) {
        zone.remove(cardId);
        return;
      }
    }
  }
  if (game.sharedZones.exile.contains(cardId)) {
    game.sharedZones.exile.remove(cardId);
    return;
  }
  if (game.sharedZones.ante.contains(cardId)) {
    game.sharedZones.ante.remove(cardId);
    return;
  }
  // Stack items are rich records keyed by sourceCardId — leaver's stack
  // items are cleaned up separately in clearLeaverStackItems. If the
  // card is ONLY on the stack (no zone membership), the stack filter
  // handles it.
};

const clearLeaverStackItems = (game: Game, seat: PlayerSeat): void => {
  const stack = game.sharedZones.stack;
  // Reuse the existing API: toArray → filter → clear → re-push. Stack
  // doesn't expose splice-by-index.
  const remaining = stack.toArray().filter((it) => it.controllerSeat !== seat);
  // Can't call clear() — Stack has no such method. Instead pop everything
  // and re-push the survivors in order. The `items` array is private; we
  // model the reset via pop() loop.
  while (!stack.isEmpty()) stack.pop();
  for (const item of remaining) stack.push(item);
};

const expireLeaverContinuousEffects = (game: Game): void => {
  // Drop effects whose source card is no longer in the game (owned by
  // leaver, just removed). The registry's unregister path + layer-
  // dispatch splices the effect's payload out of the per-layer arrays.
  const registry = game.continuousEffectRegistry;
  const orphaned = registry.all().filter((e) => e.sourceCardId !== null && !game.cards.has(e.sourceCardId));
  for (const e of orphaned) {
    registry.unregister(e.id);
  }
};
