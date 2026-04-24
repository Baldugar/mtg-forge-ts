// SPDX-License-Identifier: GPL-3.0-or-later
// CR 603 trigger registry. Subscribes to events emitted by GameAction
// (downstream of the replacement chain). Triggered abilities register
// here on zone-change-into-active-zone (Milestone F wires from statics);
// SP2 supports direct register() for effects that create triggers
// dynamically.
//
// onEvent(event): for every registered trigger, check matches(event) and
// (if present) interveningIf(event, game). If both pass, capture LKI
// (if the trigger provides captureLki) and push a PendingTrigger onto the
// drain queue.
//
// drain(): pops all pending triggers; Task 40's runPriorityWindow calls
// this on each iteration, orders via APNAP (Task 21), and stacks them.
//
// Suppression: Task 24 introduces a filter where a static (Torpor Orb
// et al.) can veto trigger registration. The filter is consulted in
// onEvent; a trigger that matches a suppression filter is silently dropped.
//
// Delayed triggers are pushed via onEventForcedByDelayed (Task 23); that
// path bypasses matches() since the delayed queue already matched, but
// still honors suppression + interveningIf + captureLki.
import type {
  DelayedTrigger,
  EntityId,
  GameEvent,
  LastKnownInfo,
  PlayerSeat,
  TriggeredAbility,
} from "@mtg-forge-ts/core";
import { ZoneType } from "@mtg-forge-ts/core";
import type { Game } from "../game.js";
import type { PendingTrigger } from "./pending-trigger.js";

export type SuppressionFilter = (
  trigger: TriggeredAbility | DelayedTrigger,
  event: GameEvent,
  game: Game,
) => boolean;

export class TriggerRegistry {
  private readonly byId = new Map<EntityId, TriggeredAbility>();
  private readonly bySourceCard = new Map<EntityId, EntityId[]>();
  private readonly pending: PendingTrigger[] = [];
  private suppressionFilters: SuppressionFilter[] = [];
  constructor(private readonly game: Game) {}

  register(t: TriggeredAbility): void {
    const existing = this.byId.get(t.id);
    this.byId.set(t.id, t);
    // WHY: registering the same id twice overwrites (id is the primary
    // key). Keep bySourceCard consistent — if the old entry was sourced by
    // a different card, remove it there; if same source, don't duplicate.
    if (existing && existing.sourceCardId !== t.sourceCardId) {
      const oldList = this.bySourceCard.get(existing.sourceCardId) ?? [];
      const oldNext = oldList.filter((x) => x !== t.id);
      if (oldNext.length === 0) this.bySourceCard.delete(existing.sourceCardId);
      else this.bySourceCard.set(existing.sourceCardId, oldNext);
    }
    const list = this.bySourceCard.get(t.sourceCardId) ?? [];
    if (!list.includes(t.id)) list.push(t.id);
    this.bySourceCard.set(t.sourceCardId, list);
  }

  unregister(id: EntityId): void {
    const t = this.byId.get(id);
    if (!t) return;
    this.byId.delete(id);
    const list = this.bySourceCard.get(t.sourceCardId) ?? [];
    const next = list.filter((x) => x !== id);
    if (next.length === 0) this.bySourceCard.delete(t.sourceCardId);
    else this.bySourceCard.set(t.sourceCardId, next);
  }

  unregisterAllForCard(cardId: EntityId): void {
    const ids = this.bySourceCard.get(cardId) ?? [];
    for (const id of ids) this.byId.delete(id);
    this.bySourceCard.delete(cardId);
  }

  onEvent(event: GameEvent): void {
    for (const t of this.byId.values()) {
      if (!t.matches(event)) continue;
      // CR 702.26e — phased-out sources don't observe most events. But
      // leaves/dies triggers read LKI and fire on the zone-change event
      // that takes the permanent off the battlefield (CR 603.10). Testing
      // `phased === true` when the card just zoned out would silently drop
      // valid dies triggers whose source was phased-out when lethal damage
      // was assessed. Audit A-006.
      //
      // Gate: apply the phased-out suppression only to events that are NOT
      // a zone-change leaving the battlefield. Dies / leaves proceed using
      // the trigger's own captureLki.
      const sourceCard = this.game.cards.get(t.sourceCardId);
      const isLeavingBattlefield =
        event.kind === "CardChangedZone" && event.payload.fromZone === ZoneType.Battlefield;
      if (sourceCard?.phased === true && !isLeavingBattlefield) continue;
      if (this.isSuppressed(t, event)) continue;
      if (t.interveningIf && !t.interveningIf(event, this.game)) continue;
      const lki = t.captureLki ? (t.captureLki(event, this.game) as LastKnownInfo | null) : null;
      const sourceCtl = this.resolveSourceController(t);
      this.pending.push({
        id: this.game.newEntityId(),
        triggerId: t.id,
        sourceCardId: t.sourceCardId,
        event,
        lki,
        sourceControllerAtFire: sourceCtl,
        firedAtTurn: this.game.turn,
        firedAtPhase: this.game.phase,
      });
    }
  }

  // Task 23 — DelayedTriggerQueue funnels matched delayed triggers here.
  // Bypasses matches() (queue already matched) but still runs suppression
  // + interveningIf + captureLki so the semantic surface stays uniform.
  onEventForcedByDelayed(d: DelayedTrigger, event: GameEvent): void {
    if (this.isSuppressed(d, event)) return;
    // DelayedTrigger does not expose an `interveningIf` field in its type
    // (Task 10), but nothing prevents a future delayed variant from
    // carrying one; check defensively via a duck-typed read.
    const maybeIif = (d as unknown as { interveningIf?: (e: GameEvent, g: unknown) => boolean })
      .interveningIf;
    if (maybeIif && !maybeIif(event, this.game)) return;
    const maybeCap = (d as unknown as { captureLki?: (e: GameEvent, g: unknown) => unknown }).captureLki;
    const lki = maybeCap ? (maybeCap(event, this.game) as LastKnownInfo | null) : null;
    const sourceCtl = this.resolveSourceController(d);
    this.pending.push({
      id: this.game.newEntityId(),
      triggerId: d.id,
      sourceCardId: d.sourceCardId,
      event,
      lki,
      sourceControllerAtFire: sourceCtl,
      firedAtTurn: this.game.turn,
      firedAtPhase: this.game.phase,
    });
  }

  drain(): readonly PendingTrigger[] {
    const out = [...this.pending];
    this.pending.length = 0;
    return out;
  }

  peekPending(): readonly PendingTrigger[] {
    return [...this.pending];
  }

  /**
   * Snapshot-restore hook (SP2 Milestone X, Task 75). Re-installs a pending
   * entry captured by an earlier snapshot without re-running matches /
   * suppression / interveningIf / captureLki. Every field is carried
   * verbatim because the snapshot already witnessed the matching pass.
   *
   * Must not be called from live gameplay — bypassing the matching pipeline
   * would let arbitrary PendingTrigger entries enter the queue without
   * source validation. The snapshot module is the only expected caller.
   */
  pushRestoredPending(pt: PendingTrigger): void {
    this.pending.push(pt);
  }

  getTrigger(id: EntityId): TriggeredAbility | undefined {
    return this.byId.get(id);
  }

  size(): number {
    return this.byId.size;
  }

  // Task 24: suppression-filter registration.
  addSuppressionFilter(filter: SuppressionFilter): void {
    this.suppressionFilters.push(filter);
  }

  removeSuppressionFilter(filter: SuppressionFilter): void {
    this.suppressionFilters = this.suppressionFilters.filter((f) => f !== filter);
  }

  suppressionFilterCount(): number {
    return this.suppressionFilters.length;
  }

  private isSuppressed(trigger: TriggeredAbility | DelayedTrigger, event: GameEvent): boolean {
    return this.suppressionFilters.some((f) => f(trigger, event, this.game));
  }

  private resolveSourceController(t: TriggeredAbility | DelayedTrigger): PlayerSeat {
    const card = this.game.cards.get(t.sourceCardId);
    // WHY fallback to activePlayer: emblems/tokens without a tracked Card
    // (rare for triggered abilities but possible for delayed triggers
    // whose source is a no-longer-tracked emblem) still need a seat. The
    // controllerSeatAtReg — captured at registration — is the most
    // faithful fallback; activePlayer is the outermost safety net.
    return card?.controllerSeat ?? (t.controllerSeatAtReg as PlayerSeat | null) ?? this.game.activePlayer;
  }
}
