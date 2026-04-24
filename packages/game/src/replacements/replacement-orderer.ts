// SPDX-License-Identifier: GPL-3.0-or-later
// CR 616 — when multiple replacements apply to the same event, the order
// chooser is:
//   (a) single affected player exists → that player
//   (b) else single affected object → its controller
//   (c) else active player
//
// The orderer is a generator: it yields at most one `orderReplacements`
// decision per layer bucket (CR 616.1). Replacements are first partitioned
// into 5 layer buckets (cantHappen → control → copy → transform → other)
// and within each non-trivial bucket the affected-player/controller/AP
// tiebreak chooses the order. Single-element buckets are appended without
// yielding a decision. If all replacements share layer "other" (the SP2-era
// default), behaviour is identical to the pre-partition implementation —
// no regression.
//
// Callers (apply-loop in Task 18, GameAction.applyWithReplacements in
// Task 19) apply the list in order, calling apply() on each until the
// intent is mutated, prevented, or no replacements remain.
import type { EntityId, MutationIntent, PlayerSeat, ReplacementAbility } from "@mtg-forge-ts/core";
import { REPLACEMENT_LAYERS } from "@mtg-forge-ts/core";
import type { EngineYield } from "../action/engine-yield.js";
import type { Game } from "../game.js";

/**
 * Extract the "affected player" from a damage/life-change/draw intent if
 * there is one. Returns null if the intent doesn't target a single player.
 * We read payload fields defensively — MutationIntent is a string-keyed
 * bag at the core boundary and game-side intent kinds live in
 * ./mutation-intent.ts.
 */
const affectedPlayer = (intent: MutationIntent): PlayerSeat | null => {
  if (intent.kind === "damage") {
    const targetKind = (intent as { targetKind?: unknown }).targetKind;
    if (targetKind === "player") {
      const pid = (intent as { targetId?: unknown }).targetId;
      return typeof pid === "number" ? (pid as PlayerSeat) : null;
    }
    return null;
  }
  if (intent.kind === "lifeChange" || intent.kind === "drawCards") {
    const seat = (intent as { seat?: unknown }).seat;
    return typeof seat === "number" ? (seat as PlayerSeat) : null;
  }
  return null;
};

/**
 * Extract the affected card's controller if the intent acts on a single
 * card (moveTo, addCounter, removeCounter, tap, untap, destroy, exile,
 * sacrifice). Returns null if the intent has no cardId or the card is
 * not registered.
 */
const affectedObjectController = (intent: MutationIntent, game: Game): PlayerSeat | null => {
  const cid = (intent as { cardId?: unknown }).cardId;
  if (typeof cid !== "number") return null;
  const card = game.cards.get(cid as EntityId);
  return card?.controllerSeat ?? null;
};

const chooseOrderer = (intent: MutationIntent, game: Game): PlayerSeat => {
  const ap = affectedPlayer(intent);
  if (ap !== null) return ap;
  const ac = affectedObjectController(intent, game);
  if (ac !== null) return ac;
  return game.activePlayer;
};

const isValidOrder = (order: readonly EntityId[], applicable: readonly ReplacementAbility[]): boolean => {
  if (order.length !== applicable.length) return false;
  const appIds = new Set(applicable.map((r) => r.id));
  const seen = new Set<EntityId>();
  for (const id of order) {
    if (!appIds.has(id)) return false;
    if (seen.has(id)) return false;
    seen.add(id);
  }
  return true;
};

/**
 * Order a single layer bucket per CR 616 tiebreak. Yields at most one
 * decision (only when bucket.length > 1). Returns the ordered EntityIds.
 */
function* orderBucket(
  bucket: readonly ReplacementAbility[],
  intent: MutationIntent,
  game: Game,
): Generator<EngineYield, readonly EntityId[], unknown> {
  if (bucket.length === 0) return [];
  if (bucket.length === 1) {
    const only = bucket[0];
    return only ? [only.id] : [];
  }
  const orderer = chooseOrderer(intent, game);
  const response = (yield {
    kind: "decision",
    request: {
      kind: "orderReplacements",
      playerSeat: orderer,
      replacementIds: bucket.map((r) => r.id),
    },
  }) as { order: readonly EntityId[] } | undefined;
  if (!response || !Array.isArray(response.order) || !isValidOrder(response.order, bucket)) {
    throw new Error(
      `orderReplacements: invalid response ${JSON.stringify(
        response,
      )} — must be a permutation of ${JSON.stringify(bucket.map((r) => r.id))}`,
    );
  }
  return response.order;
}

/**
 * Order a batch of replacements per CR 616.1. First partitions applicable[]
 * into 5 layer buckets (cantHappen → control → copy → transform → other)
 * in canonical order, then for each non-empty bucket yields at most one
 * decision (when the bucket has 2+ replacements) using the
 * affected-player/controller/AP tiebreak. Single-element buckets are
 * appended directly without yielding a decision.
 *
 * Backward-compat: if all applicable are layer "other" (the SP2-era
 * default), exactly one decision is yielded when applicable.length > 1 —
 * identical to the pre-partition behaviour.
 */
export function* orderReplacements(
  applicable: readonly ReplacementAbility[],
  intent: MutationIntent,
  game: Game,
): Generator<EngineYield, readonly EntityId[], unknown> {
  if (applicable.length === 0) return [];
  if (applicable.length === 1) {
    const only = applicable[0];
    return only ? [only.id] : [];
  }

  // Partition into buckets keyed by layer, in canonical order.
  // All 5 layer keys are pre-populated so every lookup is defined.
  const bucketMap = new Map<string, ReplacementAbility[]>(REPLACEMENT_LAYERS.map((layer) => [layer, []]));
  for (const r of applicable) {
    const b = bucketMap.get(r.layer);
    if (b) b.push(r);
  }

  const result: EntityId[] = [];
  for (const layer of REPLACEMENT_LAYERS) {
    const bucket = bucketMap.get(layer) ?? [];
    if (bucket.length === 0) continue;
    const ordered = yield* orderBucket(bucket, intent, game);
    for (const id of ordered) result.push(id);
  }
  return result;
}
