// SPDX-License-Identifier: GPL-3.0-or-later
// CR 704.5 state-based action engine. sweep() collects every applicable
// SBA, applies all of them simultaneously (CR 704.3), records the batch,
// re-checks, loops to fixpoint. Returns the list of batches applied.
//
// Integration: Task 40's runPriorityWindow will call
//   const batches = yield* this.game.sbaEngine.sweep();
// and drain trigger queue after each batch.
import { CounterType, IllegalDecisionError, ZoneType, mkEvent } from "@mtg-forge-ts/core";
import type { DecisionRequest, DecisionResponse, EntityId, PhaseStep, PlayerSeat } from "@mtg-forge-ts/core";
import type { EngineYield } from "../action/engine-yield.js";
import { removePlayerFromGame } from "../end/leave-game.js";
import type { Game } from "../game.js";
import type { PlayerLoss, LossReason as TerminalLossReason, TerminalState } from "../terminal-state.js";
import { collectAttachmentLegality } from "./attachment-legality.js";
import { collectBestow, collectCommander } from "./bestow-commander.js";
import { collectCounterCancel } from "./counter-cancel.js";
import { collectCreatureRemoval } from "./creature-removal.js";
import { collectLegendWorld } from "./legend-world.js";
import { collectLossConditions } from "./loss-conditions.js";
import { collectSagaAndClass } from "./saga-class.js";
import type { SbaAction } from "./sba-action.js";
import { collectPhasedOwnerLeaves, collectTokenAndCopy } from "./token-copy-phased.js";

// The PlayerLost event's reason taxonomy is fixed (CR 104.3 / event.ts).
type LossReason = "life" | "decked" | "poison" | "concede" | "effect";

// Map the narrow PlayerLost event reason to the richer TerminalState
// LossReason. Task 68 taxonomy: CR 104.3 a-d + draw + commanderDamage +
// antePaid + effect catch-all. SBAs only surface a subset here — other
// LossReasons (commanderDamage, antePaid, gameDrawn) are written by
// their specific pipelines (not the SBA engine).
const sbaReasonToTerminalReason = (r: LossReason): TerminalLossReason => {
  switch (r) {
    case "life":
      return "lifeLoss";
    case "poison":
      return "poisonLoss";
    case "decked":
      return "libraryLoss";
    case "concede":
      return "concede";
    case "effect":
      return "effect";
    default: {
      const _: never = r;
      throw new Error(`sbaReasonToTerminalReason: unreachable ${JSON.stringify(_)}`);
    }
  }
};

export class SbaEngine {
  // WHY bound: MTG rules guarantee that SBA sweeps terminate (every SBA
  // strictly reduces some observable: card counts on battlefield, counters
  // on a card, etc.). This cap catches engine bugs (a collector that
  // re-emits the same action without mutating state).
  static readonly MAX_ITERATIONS = 100;

  constructor(protected readonly game: Game) {}

  *sweep(): Generator<EngineYield, readonly (readonly SbaAction[])[], unknown> {
    const batches: (readonly SbaAction[])[] = [];
    for (let iter = 0; iter < SbaEngine.MAX_ITERATIONS; iter++) {
      const actions = this.collectApplicable();
      if (actions.length === 0) {
        return batches;
      }
      yield* this.applyBatch(actions);
      batches.push(actions);
      yield {
        kind: "event",
        event: mkEvent("StateBasedActionApplied", this.game.turn, this.game.phase, {
          actionCount: actions.length,
        }),
      };
    }
    throw new Error(`SbaEngine.sweep: exceeded ${SbaEngine.MAX_ITERATIONS} iterations — likely bug`);
  }

  // Tasks 30-32 populate the per-category collectors. Keeping them as
  // protected methods lets test subclasses override collectApplicable
  // (or specific helpers) without touching production code.
  protected collectApplicable(): SbaAction[] {
    const out: SbaAction[] = [];
    this.collectLossConditions(out);
    this.collectCreatureRemoval(out);
    this.collectLegendWorld(out);
    this.collectTokenAndCopy(out);
    this.collectPhasedOwnerLeaves(out);
    this.collectAttachmentLegality(out);
    this.collectCounterCancel(out);
    this.collectSagaAndClass(out);
    this.collectBestow(out);
    this.collectCommander(out);
    return out;
  }

  protected collectLossConditions(out: SbaAction[]): void {
    collectLossConditions(this.game, out);
  }
  protected collectCreatureRemoval(out: SbaAction[]): void {
    collectCreatureRemoval(this.game, out);
  }
  protected collectLegendWorld(out: SbaAction[]): void {
    collectLegendWorld(this.game, out);
  }
  protected collectTokenAndCopy(out: SbaAction[]): void {
    collectTokenAndCopy(this.game, out);
  }
  protected collectPhasedOwnerLeaves(out: SbaAction[]): void {
    collectPhasedOwnerLeaves(this.game, out);
  }
  protected collectAttachmentLegality(out: SbaAction[]): void {
    collectAttachmentLegality(this.game, out);
  }
  protected collectCounterCancel(out: SbaAction[]): void {
    collectCounterCancel(this.game, out);
  }
  protected collectSagaAndClass(out: SbaAction[]): void {
    collectSagaAndClass(this.game, out);
  }
  protected collectBestow(out: SbaAction[]): void {
    collectBestow(this.game, out);
  }
  protected collectCommander(out: SbaAction[]): void {
    collectCommander(this.game, out);
  }

  *applyBatch(actions: readonly SbaAction[]): Generator<EngineYield, void, unknown> {
    // CR 704.3 — all applicable SBAs in one check apply simultaneously.
    // We apply sequentially but don't re-check until the batch completes.
    // Triggers generated by each apply queue via Game.emitEvent; they drain
    // at the next priority window (Task 40).
    for (const action of actions) {
      yield* this.apply(action);
    }
  }

  protected *apply(action: SbaAction): Generator<EngineYield, void, unknown> {
    switch (action.kind) {
      case "playerLosesLifeZero":
      case "playerLosesPoison":
      case "playerLosesEmptyDraw":
        yield* this.applyPlayerLoss(action);
        return;
      case "creatureZeroToughness":
        yield* this.game.action.moveTo(action.cardId, ZoneType.Graveyard);
        return;
      case "creatureLethalDamage":
        yield* this.game.action.destroy(action.cardId, { cause: "sba" });
        return;
      case "planeswalkerZeroLoyalty":
        yield* this.game.action.moveTo(action.cardId, ZoneType.Graveyard);
        return;
      case "battleZeroDefense":
        yield* this.game.action.exile(action.cardId);
        return;
      case "legendRule":
        yield* this.applyLegendRule(action);
        return;
      case "worldRule":
        yield* this.applyWorldRule(action);
        return;
      case "tokenCeaseExistence":
        this.applyTokenCease(action.cardId);
        return;
      case "copyRevert": {
        const card = this.game.cards.get(action.cardId);
        if (card) {
          card.copiedFrom = null;
          this.game.layerEngine.bumpEpoch("copy-revert");
        }
        return;
      }
      case "phasedOutOwnerLeaves":
        // Milestone L placeholder (CR 702.26c). Nothing to do in SP2.
        return;
      case "auraUnattachedInvalid":
        yield* this.game.action.moveTo(action.cardId, ZoneType.Graveyard);
        return;
      case "equipmentUnattach":
      case "fortificationUnattach":
        yield* this.game.action.unattach(action.cardId, "sba");
        return;
      case "countersPairwiseCancel":
        this.applyCountersPairwiseCancel(action);
        return;
      case "sagaSacrificed":
        yield* this.game.action.sacrifice(action.cardId);
        return;
      case "classGainLevel":
        yield* this.game.action.addCounter(action.cardId, CounterType.Level, 1);
        return;
      case "bestowAuraReverts":
        this.applyBestowAuraReverts(action.cardId);
        return;
      case "bestowAuraDetach":
        this.applyBestowAuraDetach(action.cardId);
        return;
      case "commanderToCommandZone": {
        // WHY explicit toSeat: the card may be in a shared zone (exile,
        // ante) where locate() returns owner:null; defaultDestinationSeat
        // then resolves to null for Command, which isn't a valid shared
        // zone destination. Command is per-player, keyed by the card's
        // ownerSeat — read that directly.
        const card = this.game.cards.get(action.cardId);
        if (card) {
          yield* this.game.action.moveTo(action.cardId, ZoneType.Command, {
            toSeat: card.ownerSeat,
          });
        }
        return;
      }
      default: {
        const _: never = action;
        throw new Error(`SbaEngine.apply: unreachable ${JSON.stringify(_)}`);
      }
    }
  }

  private *applyPlayerLoss(
    action: Extract<
      SbaAction,
      { kind: "playerLosesLifeZero" | "playerLosesPoison" | "playerLosesEmptyDraw" }
    >,
  ): Generator<EngineYield, void, unknown> {
    const reasonMap: Record<typeof action.kind, LossReason> = {
      playerLosesLifeZero: "life",
      playerLosesPoison: "poison",
      playerLosesEmptyDraw: "decked",
    };
    const reason = reasonMap[action.kind];
    const seat = action.seat;
    // Clear the failed-draw flag so the SBA doesn't re-fire on the next
    // sweep. Life / poison are the condition themselves; clearing them is
    // not meaningful (the player remains below zero).
    if (action.kind === "playerLosesEmptyDraw") {
      this.game.getPlayer(seat).failedDrawFromEmptyLibrary = false;
    }
    // Mark the player as lost BEFORE emitting so a same-sweep double-loss
    // (simultaneous life=0 + poison>=10) doesn't emit twice; the second
    // check in collectLossConditions sees the player as already lost.
    this.markPlayerLost(seat, reason);
    yield this.game.emitEvent(
      mkEvent("PlayerLost", this.game.turn, this.game.phase, {
        playerSeat: seat,
        reason,
      }),
    );
    // CR 800.4 — in multiplayer games (≥3 seats) the leaving player's
    // objects leave the game and other players gain control of objects
    // they own. Skipping the cleanup in 2-player matches is safe: the
    // match-end flow sets terminalState before any further SBA sweep,
    // and no non-leaver owner can reclaim control (only the one
    // remaining player IS the non-leaver owner).
    if (this.game.players.length > 2) {
      yield* removePlayerFromGame(this.game, seat);
    }
  }

  // SP2 Task 68 — terminal-state bookkeeping with rich loss-reason
  // taxonomy. In addition to the legacy `concededSeats` roster, we now
  // populate `losses: PlayerLoss[]` with each player's specific LossReason
  // (lifeLoss / poisonLoss / libraryLoss / concede / …).
  private markPlayerLost(seat: PlayerSeat, reason: LossReason): void {
    const current = this.game.terminalState;
    const existingLosses = current?.losses ?? [];
    if (existingLosses.some((l) => l.seat === seat)) return;

    const terminalReason = sbaReasonToTerminalReason(reason);
    const losses: PlayerLoss[] = [...existingLosses, { seat, reason: terminalReason }];
    const lostSeats = losses.map((l) => l.seat);
    const livingSeats = this.game.players.filter((p) => !lostSeats.includes(p.seat)).map((p) => p.seat);

    const endedAt: { turn: number; phase: PhaseStep } = {
      turn: this.game.turn,
      phase: this.game.phase,
    };

    let next: TerminalState;
    if (livingSeats.length === 1) {
      const winner = livingSeats[0];
      if (winner === undefined) {
        next = {
          endedAt,
          outcome: { kind: "draw", reason },
          concededSeats: lostSeats,
          losses,
        };
      } else {
        next = {
          endedAt,
          outcome: { kind: "win", winner, reason },
          concededSeats: lostSeats,
          losses,
        };
      }
    } else if (livingSeats.length === 0) {
      next = {
        endedAt,
        outcome: { kind: "draw", reason },
        concededSeats: lostSeats,
        losses,
      };
    } else {
      // Multi-player: still in progress; bundle the running losses without
      // a concluding outcome so observers can see them.
      next = {
        endedAt,
        // Placeholder outcome until the last seat falls. `concededSeats` +
        // `losses` are the authoritative rosters.
        outcome: { kind: "draw", reason },
        concededSeats: lostSeats,
        losses,
      };
    }
    this.game.terminalState = next;
  }

  // === Task 31 helpers ===

  // Legend rule — controller chooses the keeper; all other candidates go
  // to their owners' graveyards. We consult the decision contract even
  // when only two candidates exist (no automatic heuristic), because
  // controllers may want to log the choice for replays.
  private *applyLegendRule(
    action: Extract<SbaAction, { kind: "legendRule" }>,
  ): Generator<EngineYield, void, unknown> {
    // Stale candidates (moved off the battlefield between SBA collection
    // and this apply step) are filtered out defensively; if fewer than
    // two remain, the rule no longer applies.
    const live = action.candidateIds.filter((id) => {
      const c = this.game.cards.get(id);
      return c !== undefined && c.zone === ZoneType.Battlefield;
    });
    if (live.length < 2) return;
    const request: DecisionRequest = {
      kind: "chooseLegendKeeper",
      playerSeat: action.controllerSeat,
      candidateIds: live,
    };
    const response = (yield { kind: "decision", request }) as DecisionResponse;
    if (response.kind !== "chooseLegendKeeper") {
      throw new IllegalDecisionError(
        `SbaEngine.applyLegendRule: expected chooseLegendKeeper, got ${response.kind}`,
      );
    }
    if (!live.includes(response.keeperId)) {
      throw new IllegalDecisionError(
        `SbaEngine.applyLegendRule: keeperId ${response.keeperId} not among candidates`,
      );
    }
    for (const id of live) {
      if (id === response.keeperId) continue;
      yield* this.game.action.moveTo(id, ZoneType.Graveyard);
    }
  }

  // World rule — non-keepers go to their owners' graveyards. The keeper
  // selection already happened at collect time (most recent timestamp);
  // cardIds here is the non-keeper set.
  private *applyWorldRule(
    action: Extract<SbaAction, { kind: "worldRule" }>,
  ): Generator<EngineYield, void, unknown> {
    for (const id of action.cardIds) {
      const card = this.game.cards.get(id);
      if (!card || card.zone !== ZoneType.Battlefield) continue;
      yield* this.game.action.moveTo(id, ZoneType.Graveyard);
    }
  }

  // Token cease-existence: remove from whatever zone it sits in + drop
  // from the registry so layer computations don't re-surface it.
  // We don't emit an event here — the SBA wrapper's StateBasedActionApplied
  // covers the observability; Milestone L's token factory pipeline will
  // add a canonical TokenVanished event later if needed.
  private applyTokenCease(cardId: EntityId): void {
    const card = this.game.cards.get(cardId);
    if (!card) return;
    // Remove from the zone it's in. Zones are owner-keyed except for
    // shared (exile/ante/stack); tokens are typically cleaned up from
    // exile/graveyard/hand, all of which are addressable via the owner.
    this.removeFromCurrentZone(cardId);
    this.game.cards.delete(cardId);
    this.game.layerEngine.bumpEpoch("token-cease");
  }

  // CR 704.5r — pairwise cancel. We subtract min(plus, minus) from each
  // counter type directly (bypassing GameAction.removeCounter's two-event
  // pipeline) because the cancel is a single simultaneous action per
  // 704.3; emitting two CounterRemoved events would misrepresent the
  // timing of any trigger that watches counter removal. Future work: if
  // trigger parity with Forge demands the split events, route through
  // GameAction with a "reason: sba-cancel" tag.
  private applyCountersPairwiseCancel(action: Extract<SbaAction, { kind: "countersPairwiseCancel" }>): void {
    const card = this.game.cards.get(action.cardId);
    if (!card) return;
    const cancel = Math.min(action.plusCount, action.minusCount);
    if (cancel <= 0) return;
    const plusRemaining = action.plusCount - cancel;
    const minusRemaining = action.minusCount - cancel;
    if (plusRemaining === 0) card.counters.delete(CounterType.PlusOnePlusOne);
    else card.counters.set(CounterType.PlusOnePlusOne, plusRemaining);
    if (minusRemaining === 0) card.counters.delete(CounterType.MinusOneMinusOne);
    else card.counters.set(CounterType.MinusOneMinusOne, minusRemaining);
    this.game.layerEngine.bumpEpoch("counter-cancel");
  }

  // CR 702.103 — bestow reverts when the aura leaves the battlefield; the
  // card resumes its creature identity. SP2 clears the flag only; SP3's
  // bestow pipeline wires the full face-swap / characteristic restore.
  private applyBestowAuraReverts(cardId: EntityId): void {
    const card = this.game.cards.get(cardId);
    if (!card) return;
    card.bestowed = false;
    this.game.layerEngine.bumpEpoch("bestow-revert");
  }

  // CR 702.103 — bestowed Aura on the battlefield whose target left.
  // Clear both `bestowed` and `attachedTo`; the card stays on the
  // battlefield. deriveBaseCharacteristics's bestow flip is gated on
  // `bestowed && attachedTo !== null`; once we clear them, the next
  // computeCharacteristics returns the printed Creature form.
  private applyBestowAuraDetach(cardId: EntityId): void {
    const card = this.game.cards.get(cardId);
    if (!card) return;
    // Clear the back-pointer on whatever target the aura WAS pointing at,
    // even if that target is no longer on the battlefield. This keeps the
    // attachments[] list of any lingering target free of stale ids.
    if (card.attachedTo !== null) {
      const prev = this.game.cards.get(card.attachedTo);
      if (prev) {
        prev.attachments = prev.attachments.filter((x) => x !== cardId);
      }
      card.attachedTo = null;
    }
    card.bestowed = false;
    this.game.layerEngine.bumpEpoch("bestow-detach");
  }

  // Zone-agnostic removal used by token cease-existence. Walks every
  // zone the card could be in (owner-scoped + shared) and removes on
  // first hit.
  private removeFromCurrentZone(cardId: EntityId): void {
    const game = this.game;
    // Owner-scoped zones first.
    for (const player of game.players) {
      for (const zone of player.zones.values()) {
        if (zone.contains(cardId)) {
          zone.remove(cardId);
          return;
        }
      }
    }
    // Shared zones.
    if (game.sharedZones.exile.contains(cardId)) {
      game.sharedZones.exile.remove(cardId);
      return;
    }
    if (game.sharedZones.ante.contains(cardId)) {
      game.sharedZones.ante.remove(cardId);
      return;
    }
    // Stack is rich StackItem, not simple card-id membership; SP2 tokens
    // don't live on the stack as of this task — skip silently if not
    // found anywhere.
  }
}
