// SPDX-License-Identifier: GPL-3.0-or-later
// GameAction — generator-based mutation API over Game state. Every mutating
// operation is a generator function that:
//   1. builds a typed MutationIntent describing the pending mutation,
//   2. routes through applyReplacementLoop (CR 614) via applyWithReplacements,
//   3. emits ReplacementApplied per replacement id that fired, then either
//      EventPrevented (on prevention) or the canonical GameEvent + actual
//      state mutation (on apply, using the possibly-mutated final intent).
//
// SP1 shape emitted the canonical event and mutated state directly. SP2
// Task 19 layers replacement routing on top without changing the public
// generator signatures. Triggers (Milestone E) observe the canonical events
// downstream of this routing. State-based-actions (Milestone G) run outside
// GameAction.
//
// SP3 fills in costs (the `_cost` / `costPaid` slots currently `unknown`).
//
// Why generators: the driver needs to pause mid-mutation to ask controllers
// for decisions (choose order of replacements, scry order, blocker orders,
// etc.). Generators make the pause-and-resume contract explicit at the
// type-system level via the EngineYield union.
import type {
  CounterType,
  DecisionResponse,
  EffectDuration,
  EntityId,
  GameEvent,
  MutationIntent,
  PaperCard,
  PlayerSeat,
  StaticAbility,
  ZoneType,
} from "@mtg-forge-ts/core";
import {
  CounterType as CT,
  GameStateIntegrityError,
  IllegalDecisionError,
  ZoneType as Zt,
  mkEvent,
} from "@mtg-forge-ts/core";
import { activateAbility as activateAbilityImpl } from "../ability/activate.js";
import { Card } from "../card.js";
import { damageProtected } from "../combat/keywords/protection.js";
import { turnFaceUp as turnFaceUpOp } from "../face-down/turn-face-up.js";
import type { Game } from "../game.js";
import { type LoopShortcutResult, requestShortcut as loopRequestShortcut } from "../loop/loop-shortcut.js";
import { flip as flipOp } from "../multiface/flip.js";
import { meld as meldOp } from "../multiface/meld.js";
import { transform as transformOp } from "../multiface/transform.js";
import * as phasing from "../phasing/phasing-ops.js";
import { applyReplacementLoop } from "../replacements/apply-loop.js";
import type {
  AddCounterIntent,
  AttachIntent,
  ControlChangeIntent,
  DamageIntent,
  DestroyIntent,
  DrawCardsIntent,
  ExileIntent,
  GameLossIntent,
  GameWinIntent,
  LifeChangeIntent,
  MillIntent,
  MoveToIntent,
  RemoveCounterIntent,
  SacrificeIntent,
  TapIntent,
  UnattachIntent,
  UntapIntent,
} from "../replacements/mutation-intent.js";
import type { StackItem } from "../stack/stack-item.js";
import { onZoneChange } from "../statics/zone-activation.js";
import type { Zone } from "../zone/zone.js";
import type { EngineYield } from "./engine-yield.js";

// Local union of every intent kind GameAction routes. Kept here (not in
// mutation-intent.ts) because applyWithReplacements is the only consumer
// that needs the narrowed generic bound.
type RoutedIntent =
  | DamageIntent
  | LifeChangeIntent
  | DrawCardsIntent
  | MoveToIntent
  | AddCounterIntent
  | RemoveCounterIntent
  | TapIntent
  | UntapIntent
  | DestroyIntent
  | ExileIntent
  | SacrificeIntent
  | MillIntent
  | ControlChangeIntent
  | AttachIntent
  | UnattachIntent
  | GameLossIntent
  | GameWinIntent;

export class GameAction {
  constructor(private readonly game: Game) {}

  // === Replacement-routing helper (SP2 Task 19) ===

  /**
   * Route a single mutation intent through the replacement apply-loop and
   * emit the appropriate engine events around the actual state mutation.
   *
   * Control flow:
   *   1. yield* applyReplacementLoop(intent, game) — pauses for CR 616
   *      ordering decisions if more than one replacement is applicable.
   *   2. For each id in appliedIds, emit ReplacementApplied (carries the
   *      original + replaced intent so observers see the pre/post pair).
   *   3. If status === "prevented": emit EventPrevented with the original
   *      intent and return { prevented: true }. Skip mutation + canonical
   *      event.
   *   4. If status === "applied": invoke onApplied(final) so the caller
   *      performs the real state mutation based on the (possibly mutated)
   *      final intent, then emit the canonical event derived from final.
   *
   * WHY one helper: every mutator pays the same choreography — gather,
   * order, apply, emit. Factoring it here keeps the per-mutator code
   * focused on (a) building the intent and (b) the onApplied callback.
   *
   * Per reviewer C1: we never short-circuit the yield* even when the
   * registry is empty. The apply-loop itself handles the empty case in a
   * single Map iteration and returns status:"applied" with the input
   * intent. Keeping the call uniform guarantees consistent event emission.
   *
   * Per reviewer C2: event emission lives here, not inside apply-loop.
   * apply-loop stays pure — it only yields orderReplacements decisions.
   */
  private *applyWithReplacements<I extends RoutedIntent>(
    intent: I,
    onApplied: (final: I) => void,
    buildCanonicalEvent: (final: I) => GameEvent,
  ): Generator<EngineYield, { readonly prevented: boolean }, unknown> {
    const game = this.game;
    // WHY cast through unknown: MutationIntent is declared in core as
    // `Readonly<Record<string, unknown>> & { kind: string }` — an index-
    // signatured shape — and our concrete intent types (DamageIntent,
    // MoveToIntent, …) omit the string index signature. Structural
    // compatibility flows one way: concrete → generic requires a widening
    // cast. The runtime shape is identical.
    const result = yield* applyReplacementLoop(intent as unknown as MutationIntent, game);
    // Emit ReplacementApplied per fired replacement, in apply order. On
    // prevent, `replaced` is null (the last replacement returned null);
    // on apply, `replaced` is the final intent after the full chain.
    // WHY not per-step snapshots: SP2 event payload is {original, replaced}
    // for the whole chain (Task 12 payload shape). Per-step intermediate
    // states are SP3 if anyone ever needs them.
    const replaced = result.status === "applied" ? result.final : null;
    // WHY direct yield for ReplacementApplied/EventPrevented: engine-internal
    // events observability-only; they must NOT route into trigger/delayed-
    // trigger registries. Game.emitEvent filters them regardless, but
    // skipping the funnel keeps the intent explicit and avoids the wasted
    // ENGINE_INTERNAL_EVENT_KINDS lookup on the hot replacement path.
    for (const rid of result.appliedIds) {
      yield {
        kind: "event",
        event: mkEvent("ReplacementApplied", game.turn, game.phase, {
          replacementId: rid,
          original: intent,
          replaced,
        }),
      };
    }
    if (result.status === "prevented") {
      yield {
        kind: "event",
        event: mkEvent("EventPrevented", game.turn, game.phase, { original: intent }),
      };
      return { prevented: true };
    }
    if (result.status !== "applied") {
      // Exhaustiveness guard — ApplyResult is a two-variant union.
      const _never: never = result;
      throw new Error(`GameAction.applyWithReplacements: unexpected status ${String(_never)}`);
    }
    const final = result.final as I;
    onApplied(final);
    // Canonical event — route through Game.emitEvent so triggers see it.
    yield game.emitEvent(buildCanonicalEvent(final));
    return { prevented: false };
  }

  // === Draw + life + zone movement (SP1 implemented) ===

  *drawCards(
    seat: PlayerSeat,
    count: number,
    _opts?: { readonly cause?: string },
  ): Generator<EngineYield, void, unknown> {
    const game = this.game;
    const player = game.getPlayer(seat);
    const library = player.zones.get(Zt.Library);
    const hand = player.zones.get(Zt.Hand);
    if (!library) throw new GameStateIntegrityError(`Player ${seat} has no Library zone`);
    if (!hand) throw new GameStateIntegrityError(`Player ${seat} has no Hand zone`);
    // WHY per-card intents: CR 121.3 treats each individual card draw as the
    // event a replacement can intercept ("if you would draw a card, instead
    // …"). A batched draw must expose N separate replacement points. SP2
    // keeps this simple by looping in the mutator; triggers (Milestone E)
    // collapse the batch back into a single summary as needed.
    for (let i = 0; i < count; i++) {
      // WHY: Forge/Java convention — index 0 is the TOP of the library.
      // Draw consumes the front of the list; items.length-1 is the bottom.
      const topId = library.peekAt(0);
      // WHY: running out of library mid-draw is a state-based loss condition
      // (SP2). For SP1 we simply stop drawing — the caller can detect this
      // via Library.size beforehand. Emitting CardDrawn with no card would
      // violate the event contract.
      if (topId === undefined) return;
      const intent: DrawCardsIntent = { kind: "drawCards", seat, count: 1 };
      yield* this.applyWithReplacements<DrawCardsIntent>(
        intent,
        (_final) => {
          // WHY no cardId on the intent: a draw replacement (e.g. "if you
          // would draw a card, instead …") operates on the draw, not the
          // specific card. SP3 can introduce richer draw intents if needed.
          // We re-read the top here because a replacement may have mutated
          // library state (e.g. scry-on-draw) before the actual draw fires.
          // Per current SP2 scope, replacements don't mutate the library,
          // but the read is cheap and defensive.
          const removed = library.removeAt(0);
          if (removed === undefined) return;
          hand.add(removed);
          const card = game.cards.get(removed);
          if (card) card.zone = Zt.Hand;
        },
        (_final) =>
          mkEvent("CardDrawn", game.turn, game.phase, {
            playerSeat: seat,
            cardId: topId,
          }),
      );
    }
  }

  *changeLife(
    seat: PlayerSeat,
    delta: number,
    opts?: { readonly cause?: string },
  ): Generator<EngineYield, void, unknown> {
    const game = this.game;
    const player = game.getPlayer(seat);
    const intent: LifeChangeIntent = {
      kind: "lifeChange",
      seat,
      delta,
      cause: opts?.cause ?? "effect",
    };
    yield* this.applyWithReplacements<LifeChangeIntent>(
      intent,
      (final) => {
        player.life = player.life + final.delta;
      },
      (final) => {
        // oldLife/newLife derived at emit-time from the final (possibly
        // replaced) delta against the CURRENT player.life. Because
        // onApplied already ran, player.life reflects the post-apply value.
        const newLife = player.life;
        const oldLife = newLife - final.delta;
        return mkEvent("LifeChanged", game.turn, game.phase, {
          playerSeat: final.seat,
          oldLife,
          newLife,
          delta: final.delta,
          cause: final.cause,
        });
      },
    );
  }

  // === Game-win / game-loss (Batch D2) ===
  //
  // CR 104.2 / CR 104.3 — players win or lose in well-defined ways. The
  // SBA engine collects loss conditions (CR 704.5a/b/c — life=0, decked,
  // poison) and routes them through gameLoss(). Effect-driven losses
  // ("target player loses the game") also call this mutator. Both paths
  // first run through the replacement chain so cards like Platinum Angel
  // (R:Event$ GameLoss | Layer$ CantHappen) can prevent the loss before
  // PlayerLost is emitted.
  //
  // The mutator emits the canonical event (PlayerLost / PlayerWon) on
  // apply; on prevention the SBA engine sees a `prevented: true` outcome
  // and skips the terminal-state bookkeeping, so the player stays in the
  // game. The event flows through emitEvent so triggers see it; SBA
  // bookkeeping (markPlayerLost) is the caller's responsibility to keep
  // the engine state machine in sync — the mutator does not write
  // game.terminalState directly.

  *gameLoss(
    seat: PlayerSeat,
    opts?: { readonly cause?: string; readonly reason?: "life" | "decked" | "poison" | "concede" | "effect" },
  ): Generator<EngineYield, { readonly prevented: boolean }, unknown> {
    const game = this.game;
    const intent: GameLossIntent = {
      kind: "gameLoss",
      seat,
      cause: opts?.cause ?? "effect",
    };
    const reason = opts?.reason ?? "effect";
    return yield* this.applyWithReplacements<GameLossIntent>(
      intent,
      (_final) => {
        // No direct state mutation here — the SBA engine writes
        // terminalState via markPlayerLost when the canonical PlayerLost
        // event is observed. Effect-driven losers (target player loses
        // the game) likewise rely on the SBA sweep that runs after the
        // event for terminal-state convergence.
      },
      (final) =>
        mkEvent("PlayerLost", game.turn, game.phase, {
          playerSeat: final.seat,
          reason,
        }),
    );
  }

  *gameWin(
    seat: PlayerSeat,
    opts?: { readonly cause?: string },
  ): Generator<EngineYield, { readonly prevented: boolean }, unknown> {
    const game = this.game;
    const intent: GameWinIntent = {
      kind: "gameWin",
      seat,
      cause: opts?.cause ?? "effect",
    };
    return yield* this.applyWithReplacements<GameWinIntent>(
      intent,
      (_final) => {
        // Win is a terminal-state transition; the canonical PlayerWon
        // event is enough for observers. SBA / match-end bookkeeping
        // runs on the next sweep.
      },
      (final) =>
        mkEvent("PlayerWon", game.turn, game.phase, {
          playerSeat: final.seat,
        }),
    );
  }

  *moveTo(
    cardId: EntityId,
    toZone: ZoneType,
    opts?: { readonly toSeat?: PlayerSeat; readonly cause?: string },
  ): Generator<EngineYield, void, unknown> {
    const game = this.game;
    const { fromZone, owner } = this.locate(cardId);
    const toSeat = opts?.toSeat ?? this.defaultDestinationSeat(toZone, owner, cardId);
    const intent: MoveToIntent = {
      kind: "moveTo",
      cardId,
      toZone,
      toSeat,
      cause: opts?.cause ?? "effect",
    };
    const moveOutcome = yield* this.applyWithReplacements<MoveToIntent>(
      intent,
      (final) => {
        // Re-resolve from/to on final because a replacement may have
        // rewritten the target zone (e.g. "if this card would go to the
        // graveyard, exile it instead"). `fromZone/owner` were captured
        // before the loop and are correct (replacements cannot rewrite the
        // source zone — the card is where it is).
        const from = this.zoneFor(fromZone, owner);
        const to = this.zoneFor(final.toZone, final.toSeat);
        from.remove(final.cardId);
        to.add(final.cardId);
        const card = game.cards.get(final.cardId);
        if (card) {
          card.zone = final.toZone;
          if (final.toSeat !== null) card.controllerSeat = final.toSeat;
          // CR 702.26 — a phased-out permanent that changes zones phases
          // in as part of the move; the phased flag is meaningful only on
          // the battlefield. Flip silently without emitting PhasedIn — the
          // CardChangedZone event already signals the broader transition
          // and SP2 subscribers don't need a separate PhasedIn to interpret
          // it. SP3 revisits if a trigger specifically needs the pair.
          if (card.phased && final.toZone !== Zt.Battlefield) {
            card.phased = false;
          }
          // Wave 14b — CR 122.6: a permanent leaving the battlefield
          // becomes a new object with no counters. Skullbriar / Me, the
          // Immortal carry an `S:Mode$ CountersRemain` static which
          // generates a replacement intercepting a synthetic
          // `clearCountersOnZoneChange` mutation; consult the registry
          // here so the replacement can match. If unmatched, clear the
          // counters; if matched (CountersRemain returned null), keep
          // them. Hand and Library destinations always clear (per CR
          // exception in CountersRemain text — counters disappear when
          // moving to an unseen zone). Synthetic intent is NOT routed
          // through applyReplacementLoop (no event yields) — the apply
          // is local and synchronous since we're already inside the
          // canonical moveTo's onApplied callback.
          if (fromZone === Zt.Battlefield && final.toZone !== Zt.Battlefield && card.counters.size > 0) {
            const clearIntent = {
              kind: "clearCountersOnZoneChange",
              cardId: final.cardId,
              toZone: final.toZone,
            } as const;
            const applicable = game.replacementRegistry.gatherApplicable(clearIntent, new Set());
            let replaced = false;
            for (const r of applicable) {
              const next = r.apply(clearIntent, game);
              if (next === null) {
                replaced = true;
                break;
              }
            }
            if (!replaced) {
              card.counters.clear();
            }
          }
        }
        // Milestone F Task 25 — activate/deactivate intrinsic static
        // abilities whose activeInZones includes the new zone. Runs
        // BEFORE the epoch bump so the registry list reflects the new
        // state when the cache clears. onZoneChange also bumps the epoch
        // internally on a transition, which is idempotent with the
        // general moveTo bump below.
        onZoneChange(game, final.cardId, fromZone, final.toZone);
        // CR 613.1 — zone change alters which continuous effects apply
        // (layered values are defined only for permanents on the battlefield,
        // etc.); invalidate the cache so the next characteristics read
        // re-derives from the new zone. Inside onApplied so prevented moves
        // don't churn the cache.
        game.layerEngine.bumpEpoch("moveTo");
        // Task 74 — per-turn tracking. Card left the battlefield this turn
        // when `fromZone === Battlefield` and the destination is anything
        // else (including the battlefield → null controller edge case in
        // token-ceases-to-exist SBA). Reset at turn end by PhaseHandler.
        if (fromZone === Zt.Battlefield && final.toZone !== Zt.Battlefield) {
          game.flags.leftBattlefieldThisTurn.add(final.cardId);
          // SP2 Task 78 (fix 2) — clear the deathtouch-damage flag when
          // the creature leaves the battlefield. CR 702.2b is about
          // damage "on" the creature; once it leaves, the flag is no
          // longer meaningful and must reset so its next battlefield
          // entry doesn't inherit stale state.
          if (card) card.damagedByDeathtouch = false;
        }
      },
      (final) =>
        mkEvent("CardChangedZone", game.turn, game.phase, {
          cardId: final.cardId,
          fromZone,
          toZone: final.toZone,
          ...(owner !== null ? { fromSeat: owner } : {}),
          ...(final.toSeat !== null ? { toSeat: final.toSeat } : {}),
          ...(opts?.cause !== undefined ? { cause: opts.cause } : {}),
        }),
    );
    // Wave 5 — emit CardDiscarded when cause is "discard" or "handSize" so
    // DiscardedTrigger (T:Mode$ Discarded) fires correctly. owner is the
    // player whose hand the card came from; if owner is null (e.g. tokens
    // on the battlefield) there is no meaningful playerSeat and we skip.
    if (!moveOutcome.prevented && owner !== null) {
      const discardCause = opts?.cause;
      if (discardCause === "discard" || discardCause === "handSize") {
        yield game.emitEvent(
          mkEvent("CardDiscarded", game.turn, game.phase, {
            cardId,
            playerSeat: owner,
            cause: discardCause,
          }),
        );
      }
    }
  }

  // === Tap/untap ===

  *tap(cardId: EntityId): Generator<EngineYield, void, unknown> {
    const card = this.game.cards.get(cardId);
    // WHY pre-check before building intent: idempotent no-op on a missing
    // card or already-tapped permanent — no replacement chain for
    // non-events. SP2 trigger handlers listening on CardTapped do not fire
    // on redundant tap() calls per Forge semantics; skipping the intent
    // also skips replacement gather, matching reality.
    if (!card || card.tapped) return;
    const intent: TapIntent = { kind: "tap", cardId };
    yield* this.applyWithReplacements<TapIntent>(
      intent,
      (final) => {
        const c = this.game.cards.get(final.cardId);
        if (!c) return;
        c.tapped = true;
        // Tapped-state can gate continuous effects (e.g. "as long as
        // CARDNAME is tapped"). Bump only inside onApplied so prevention
        // doesn't churn the cache.
        this.game.layerEngine.bumpEpoch("tap");
      },
      (final) => mkEvent("CardTapped", this.game.turn, this.game.phase, { cardId: final.cardId }),
    );
  }

  *untap(cardId: EntityId): Generator<EngineYield, void, unknown> {
    const card = this.game.cards.get(cardId);
    if (!card || !card.tapped) return;
    const intent: UntapIntent = { kind: "untap", cardId };
    yield* this.applyWithReplacements<UntapIntent>(
      intent,
      (final) => {
        const c = this.game.cards.get(final.cardId);
        if (!c) return;
        c.tapped = false;
        this.game.layerEngine.bumpEpoch("untap");
      },
      (final) => mkEvent("CardUntapped", this.game.turn, this.game.phase, { cardId: final.cardId }),
    );
  }

  // === Phasing (SP2 Task 52) ===

  /**
   * CR 702.26 — phase a permanent out (directly). Callers are typically the
   * phasing-keyword turn-based action driver (`processPhasingOnUntap`); for
   * ad-hoc "phase X out" effects (Teferi's Veil, Vanishing, etc.) the
   * `direct: true` flag surfaces in the PhasedOut event payload so triggers
   * and replacement effects can distinguish. SP2 doesn't yet route phasing
   * through the replacement chain — SP3 will add MutationIntent kinds for
   * phase-in/out once the keyword registry lands.
   */
  *phaseOut(cardId: EntityId, opts?: { readonly direct?: boolean }): Generator<EngineYield, void, unknown> {
    yield* phasing.phaseOut(this.game, cardId, opts);
  }

  *phaseIn(cardId: EntityId, opts?: { readonly direct?: boolean }): Generator<EngineYield, void, unknown> {
    yield* phasing.phaseIn(this.game, cardId, opts);
  }

  // === Face-down turn-face-up (SP2 Task 54) ===

  /**
   * CR 701.34 — turn a face-down permanent face up. SP2 trusts the caller
   * that any applicable cost (morph / disguise / actual mana cost for
   * manifest/cloak / foretell-trigger gating) has been paid; SP3's cost
   * pipeline adds the pre-flip validation. Emits CardTurnedFaceUp on
   * success; throws GameStateIntegrityError if the card is missing or
   * already face-up.
   */
  *turnFaceUp(cardId: EntityId): Generator<EngineYield, void, unknown> {
    yield* turnFaceUpOp(this.game, cardId);
  }

  // === Multi-face toggles (SP2 Milestone Q Task 59) ===

  /**
   * CR 709 — flip a Kamigawa-style flip card in place. Toggles
   * Card.face between "default" and "flipped", bumps the layer epoch,
   * emits `Flipped`. SP2 trusts the caller that the flip trigger/
   * ability has fired; SP3 wires the trigger→flip routing.
   */
  *flip(cardId: EntityId): Generator<EngineYield, void, unknown> {
    yield* flipOp(this.game, cardId);
  }

  /**
   * CR 711 — transform a transform-DFC in place. Toggles Card.face
   * between "front" and "back", bumps the layer epoch, emits
   * `Transformed` with the new face. MDFCs do NOT transform — the
   * helper rejects MDFCs via isTransformDfc.
   */
  *transform(cardId: EntityId): Generator<EngineYield, void, unknown> {
    yield* transformOp(this.game, cardId);
  }

  /**
   * CR 701.37 — meld two cards sharing a controller into a single
   * "melded" permanent. Exiles both originals, mints a new Card on
   * the battlefield with `face: "melded"`, emits `Melded`. Returns the
   * minted permanent's id so callers can track it.
   */
  *meld(cardIdA: EntityId, cardIdB: EntityId): Generator<EngineYield, EntityId, unknown> {
    return yield* meldOp(this.game, cardIdA, cardIdB);
  }

  // === Destroy / exile / sacrifice — event + zone change via moveTo ===

  *destroy(
    cardId: EntityId,
    opts?: { readonly sourceId?: EntityId; readonly cause?: "damage" | "sba" | "effect" },
  ): Generator<EngineYield, void, unknown> {
    // Two-step flow: the destroy-intent fires first (regeneration-class
    // replacements intercept here), then a separate moveTo-intent to
    // Graveyard fires (zone-change replacements intercept there). If
    // destroy is prevented, we do NOT proceed to moveTo.
    const intent: DestroyIntent = {
      kind: "destroy",
      cardId,
      sourceId: opts?.sourceId ?? null,
      cause: opts?.cause ?? "effect",
    };
    const outcome = yield* this.applyWithReplacements<DestroyIntent>(
      intent,
      (_final) => {
        // Destroy itself is a pure event + follow-up zone move. The zone
        // move happens after (outside) applyWithReplacements so it
        // participates in its own replacement chain.
      },
      (final) =>
        mkEvent("CardDestroyed", this.game.turn, this.game.phase, {
          cardId: final.cardId,
          ...(final.sourceId !== null ? { sourceId: final.sourceId } : {}),
          cause: final.cause,
        }),
    );
    if (outcome.prevented) return;
    yield* this.moveTo(cardId, Zt.Graveyard);
  }

  *exile(cardId: EntityId, opts?: { readonly sourceId?: EntityId }): Generator<EngineYield, void, unknown> {
    const { fromZone } = this.locate(cardId);
    const intent: ExileIntent = {
      kind: "exile",
      cardId,
      sourceId: opts?.sourceId ?? null,
    };
    const outcome = yield* this.applyWithReplacements<ExileIntent>(
      intent,
      (_final) => {
        // Follow-up moveTo performs the zone change (and its own
        // replacement chain).
      },
      (final) =>
        mkEvent("CardExiled", this.game.turn, this.game.phase, {
          cardId: final.cardId,
          fromZone,
          ...(final.sourceId !== null ? { sourceId: final.sourceId } : {}),
        }),
    );
    if (outcome.prevented) return;
    yield* this.moveTo(cardId, Zt.Exile);
  }

  *sacrifice(
    cardId: EntityId,
    opts?: { readonly sourceId?: EntityId },
  ): Generator<EngineYield, void, unknown> {
    const { owner } = this.locate(cardId);
    if (owner === null) {
      throw new GameStateIntegrityError(`Cannot sacrifice ${cardId} — not owned by any player`);
    }
    const intent: SacrificeIntent = {
      kind: "sacrifice",
      cardId,
      playerSeat: owner,
      sourceId: opts?.sourceId ?? null,
    };
    const outcome = yield* this.applyWithReplacements<SacrificeIntent>(
      intent,
      (_final) => {
        // Follow-up moveTo performs the zone change.
      },
      (final) =>
        mkEvent("CardSacrificed", this.game.turn, this.game.phase, {
          cardId: final.cardId,
          playerSeat: final.playerSeat,
          ...(final.sourceId !== null ? { sourceId: final.sourceId } : {}),
        }),
    );
    if (outcome.prevented) return;
    yield* this.moveTo(cardId, Zt.Graveyard);
  }

  // === Damage ===

  *damage(
    sourceId: EntityId,
    targetKind: "creature" | "player" | "planeswalker" | "battle",
    targetId: EntityId | PlayerSeat,
    amount: number,
    isCombat: boolean,
  ): Generator<EngineYield, void, unknown> {
    const game = this.game;
    // CR 702.16b — protection damage prevention (Task 49). If the target
    // card has protection from the source, pre-zero the intent amount so
    // the replacement chain still sees a typed damage intent (for
    // observability / other replacements that may want to re-raise it)
    // but Card.damage / battle counters / life change by zero. SP3 will
    // replace this inline short-circuit with a proper Layer-6-derived
    // "if this would deal damage to X with protection, prevent" replace-
    // ment registered at keyword-grant time.
    let effectiveAmount = amount;
    if (
      effectiveAmount > 0 &&
      (targetKind === "creature" || targetKind === "planeswalker" || targetKind === "battle") &&
      typeof targetId === "number" &&
      damageProtected(game, sourceId, targetId as EntityId)
    ) {
      effectiveAmount = 0;
    }
    const intent: DamageIntent = {
      kind: "damage",
      sourceId,
      targetKind,
      targetId,
      amount: effectiveAmount,
      isCombat,
    };
    // Captured outside onApplied so we can route the player life change
    // through changeLife (which runs the replacement pipeline on the
    // LifeChange intent) AFTER the DamageDealt event has been emitted.
    // Audit I-1.
    let playerLifeRequest: { readonly seat: PlayerSeat; readonly amount: number } | null = null;
    yield* this.applyWithReplacements<DamageIntent>(
      intent,
      (final) => {
        // WHY: damage to a creature updates Card.damage; damage to a
        // player is deferred to a chained changeLife call below so the
        // LifeChange replacement pipeline observes it (audit I-1).
        if (final.amount <= 0) return;
        if (final.targetKind === "creature" && typeof final.targetId === "number") {
          const card = game.cards.get(final.targetId as EntityId);
          if (card) {
            card.damage += final.amount;
            // SP2 Task 78 (fix 2) — CR 702.2b deathtouch: tag the target
            // when the damage source has the deathtouch keyword so the
            // SBA creature-removal collector can destroy it on the next
            // sweep even if damage < toughness.
            const sourceCard = game.cards.get(final.sourceId);
            if (sourceCard && sourceCard.keywords?.has("deathtouch") === true) {
              card.damagedByDeathtouch = true;
            }
          }
        } else if (final.targetKind === "player" && typeof final.targetId === "number") {
          // Stash the amount + seat; actually route through changeLife
          // (below, after the DamageDealt event is emitted) so prevention
          // replacements registered on lifeChange observe and can intercept.
          playerLifeRequest = {
            seat: final.targetId as PlayerSeat,
            amount: final.amount,
          };
        } else if (final.targetKind === "battle" && typeof final.targetId === "number") {
          // Task 51 — damage to a battle decrements its defense counters
          // (CR 310.5). Direct counter mutation (not routed through
          // removeCounter) to avoid double-eventing: combat damage emits
          // DamageDealt; the SBA sweep (Task 30) handles the "0 defense
          // → exile" transition via its own canonical events.
          const battle = game.cards.get(final.targetId as EntityId);
          if (battle) {
            const cur = battle.counters.get(CT.Defense) ?? 0;
            const next = Math.max(0, cur - final.amount);
            if (next === 0) battle.counters.delete(CT.Defense);
            else battle.counters.set(CT.Defense, next);
            game.layerEngine.bumpEpoch("battle-damage");
          }
        }
      },
      (final) =>
        mkEvent("DamageDealt", game.turn, game.phase, {
          sourceId: final.sourceId,
          targetKind: final.targetKind,
          targetId: final.targetId,
          amount: final.amount,
          isCombat: final.isCombat,
        }),
    );
    // Audit I-1 — route damage-to-player life deduction through the full
    // replacement pipeline so prevention replacements (e.g., "if you would
    // lose life from damage, prevent it") actually fire. Previously the
    // inline Player.life mutation bypassed applyWithReplacements on the
    // LifeChange intent. We call changeLife AFTER DamageDealt is emitted
    // so the causal ordering in the event stream stays (damage dealt →
    // life changes as a consequence).
    if (playerLifeRequest !== null) {
      const req = playerLifeRequest as { readonly seat: PlayerSeat; readonly amount: number };
      yield* this.changeLife(req.seat, -req.amount, { cause: "damage" });
    }
  }

  // === Counters ===

  *addCounter(
    cardId: EntityId,
    counterType: CounterType,
    amount: number,
    sourceId?: EntityId,
  ): Generator<EngineYield, void, unknown> {
    // WHY: counter amounts are always positive integers per MTG rules.
    // Accepting 0 or negatives silently (the old behavior) let bugs
    // propagate through to observers and persisted state. Callers that
    // need "remove N" must use removeCounter.
    if (!Number.isInteger(amount) || amount <= 0) {
      throw new IllegalDecisionError(`addCounter: amount must be a positive integer, got ${amount}`);
    }
    const game = this.game;
    const intent: AddCounterIntent = {
      kind: "addCounter",
      cardId,
      counterType,
      amount,
      sourceId: sourceId ?? null,
    };
    yield* this.applyWithReplacements<AddCounterIntent>(
      intent,
      (final) => {
        const card = game.cards.get(final.cardId);
        if (card) {
          const current = card.counters.get(final.counterType) ?? 0;
          card.counters.set(final.counterType, current + final.amount);
        }
        // Counters feed Layer 7d (P/T) and can gate other continuous
        // effects (e.g. "as long as CARDNAME has a +1/+1 counter on it").
        // Epoch bump lives inside onApplied so preventions don't churn.
        game.layerEngine.bumpEpoch("counter");
        // Task 74 — per-turn tracking. Only count against the final amount
        // (after replacement rewrites), mirroring what actually landed.
        const prior = game.flags.countersAddedThisTurn.get(final.cardId) ?? 0;
        game.flags.countersAddedThisTurn.set(final.cardId, prior + final.amount);
      },
      (final) =>
        mkEvent("CounterAdded", game.turn, game.phase, {
          cardId: final.cardId,
          counterType: final.counterType,
          amount: final.amount,
          ...(final.sourceId !== null ? { sourceId: final.sourceId } : {}),
        }),
    );
  }

  *removeCounter(
    cardId: EntityId,
    counterType: CounterType,
    amount: number,
    sourceId?: EntityId,
  ): Generator<EngineYield, void, unknown> {
    if (!Number.isInteger(amount) || amount <= 0) {
      throw new IllegalDecisionError(`removeCounter: amount must be a positive integer, got ${amount}`);
    }
    const game = this.game;
    const card = game.cards.get(cardId);
    // WHY: Forge no-ops when the targeted counter type isn't present on
    // the card; that matches CR 122.1 ("you can't remove a counter that
    // isn't there"). Emitting CounterRemoved anyway would falsely signal
    // an observable change to trigger/event subscribers. Pre-check before
    // building the intent — no replacement chain for non-events.
    if (!card || !card.counters.has(counterType)) {
      return;
    }
    const intent: RemoveCounterIntent = {
      kind: "removeCounter",
      cardId,
      counterType,
      amount,
      sourceId: sourceId ?? null,
    };
    yield* this.applyWithReplacements<RemoveCounterIntent>(
      intent,
      (final) => {
        const c = game.cards.get(final.cardId);
        if (!c || !c.counters.has(final.counterType)) return;
        const current = c.counters.get(final.counterType) ?? 0;
        const next = Math.max(0, current - final.amount);
        if (next === 0) c.counters.delete(final.counterType);
        else c.counters.set(final.counterType, next);
        // Counter change → bump. The pre-check above plus this guard
        // ensure we only reach state-mutation on an observable change.
        game.layerEngine.bumpEpoch("counter");
      },
      (final) =>
        mkEvent("CounterRemoved", game.turn, game.phase, {
          cardId: final.cardId,
          counterType: final.counterType,
          amount: final.amount,
          ...(final.sourceId !== null ? { sourceId: final.sourceId } : {}),
        }),
    );
  }

  // === Control change ===

  /**
   * Change a card's controller.
   *
   * `sourceId` — for tagging the source ability (optional; propagates
   *   into the ControlChanged event payload).
   * `until` — SP2 Task 45: when set, the control change reverts
   *   automatically when the duration triggers (turn end, combat end,
   *   etc.). Implemented via ControlChangeLedger, driven from
   *   Game.emitEvent.
   *
   * Both forms remain compatible: the legacy positional `sourceId`
   * argument continues to work; when callers want a duration they pass
   * `{ sourceId, until }`.
   */
  *changeControl(
    cardId: EntityId,
    newController: PlayerSeat,
    opts?:
      | EntityId
      | {
          readonly sourceId?: EntityId;
          readonly until?: EffectDuration;
        },
  ): Generator<EngineYield, void, unknown> {
    const game = this.game;
    const card = game.cards.get(cardId);
    const oldController = card?.controllerSeat;
    if (oldController === undefined) {
      throw new GameStateIntegrityError(`changeControl: card ${cardId} not tracked`);
    }
    const normalized =
      typeof opts === "object" && opts !== null ? opts : opts !== undefined ? { sourceId: opts } : {};
    const intent: ControlChangeIntent = {
      kind: "controlChange",
      cardId,
      newController,
      sourceId: normalized.sourceId ?? null,
    };
    yield* this.applyWithReplacements<ControlChangeIntent>(
      intent,
      (final) => {
        const c = game.cards.get(final.cardId);
        if (c) c.controllerSeat = final.newController;
        // Task 45 — record time-bounded control changes BEFORE the
        // event emits so the ledger is authoritative by the time the
        // canonical event lands (observers reading the ledger see the
        // post-apply state). A permanent-duration control change is
        // recorded too, but `expiredOn` never fires for it — the
        // ledger entry is inert until an explicit forget().
        if (normalized.until !== undefined) {
          game.controlChangeLedger.record(final.cardId, oldController, normalized.until, game.turn);
        }
        // CR 613.1b — control change invalidates the LayerEngine cache
        // because layered values scoped by controller (e.g., ability-grant
        // statics) must re-evaluate. Bump before the event emit so
        // observers reading characteristics during the event see the
        // post-control-change view.
        game.layerEngine.bumpEpoch("control-change");
      },
      (final) =>
        mkEvent("ControlChanged", game.turn, game.phase, {
          cardId: final.cardId,
          oldController,
          newController: final.newController,
          ...(final.sourceId !== null ? { sourceId: final.sourceId } : {}),
        }),
    );
  }

  /**
   * SP2 Task 45 — drain the pendingControlReverts queue Game.emitEvent
   * built from the control-change ledger. Called by the priority
   * orchestrator after draining triggers so the reverting
   * ControlChanged events land in the canonical event feed (and thus
   * fire triggers themselves, recursively).
   *
   * WHY a drain queue instead of evaluating per-event inline: the
   * reversion is itself a changeControl that emits a ControlChanged
   * event, which a trigger could further respond to (e.g. "whenever a
   * creature's controller changes"). Inline reversion inside
   * Game.emitEvent (a non-generator) would crash — this indirection
   * keeps the reversion on the generator pipeline.
   */
  *drainPendingControlReverts(): Generator<EngineYield, void, unknown> {
    const ledger = this.game.controlChangeLedger;
    const pending = this.game.pendingControlReverts;
    while (pending.length > 0) {
      const cardId = pending.shift();
      if (cardId === undefined) break;
      const entry = ledger.get(cardId);
      if (!entry) continue;
      // Forget BEFORE reverting so the ledger doesn't re-trigger on its
      // own reversion's canonical ControlChanged event.
      ledger.forget(cardId);
      yield* this.changeControl(cardId, entry.priorController);
    }
  }

  // === Attach / unattach (SP2 Task 42) ===

  /**
   * Attach a source object (Aura, Equipment, Fortification) to a target
   * object. Maintains the symmetric attachedTo/attachments invariant:
   *   source.attachedTo === targetId
   *   target.attachments.includes(sourceId)
   *
   * If the source was already attached to a DIFFERENT target, we detach
   * from the prior target first — Forge's equip-to-another-creature path
   * (CR 702.6c implicit detachment before re-attachment).
   *
   * Emits CardAttached on success; replacement chain may prevent or
   * redirect (swap targetId via matches/apply returning a new intent).
   */
  *attach(
    sourceId: EntityId,
    targetId: EntityId,
    cause: "cast" | "static" | "sba" | "activated",
  ): Generator<EngineYield, void, unknown> {
    const intent: AttachIntent = { kind: "attach", sourceId, targetId, cause };
    yield* this.applyWithReplacements<AttachIntent>(
      intent,
      (final) => {
        const source = this.game.cards.get(final.sourceId);
        const target = this.game.cards.get(final.targetId);
        if (!source || !target) {
          throw new GameStateIntegrityError(
            `attach: card missing (source=${final.sourceId}, target=${final.targetId})`,
          );
        }
        // Detach from prior target if re-attaching. Identity re-attach is
        // a no-op for the `attachments` side but still drives the event.
        if (source.attachedTo !== null && source.attachedTo !== final.targetId) {
          const prev = this.game.cards.get(source.attachedTo);
          if (prev) {
            prev.attachments = prev.attachments.filter((x) => x !== final.sourceId);
          }
        }
        source.attachedTo = final.targetId;
        if (!target.attachments.includes(final.sourceId)) {
          target.attachments = [...target.attachments, final.sourceId];
        }
        // Task 43 — register per-attachment Layer 6 grants BEFORE the
        // epoch bump so checkEpoch sees the post-attach layer state.
        this.game.auraGrantLedger.onAttach(this.game, final.sourceId, final.targetId);
        // CR 613.1 — attachment change alters which continuous effects
        // apply (Aura's granted abilities, Equipment-conditioned statics).
        this.game.layerEngine.bumpEpoch("attach");
      },
      (final) =>
        mkEvent("CardAttached", this.game.turn, this.game.phase, {
          sourceId: final.sourceId,
          targetId: final.targetId,
          cause: final.cause,
        }),
    );
  }

  /**
   * Unattach a source from its current target. No-op (no event, no
   * state change) when the source is not attached — mirrors the
   * tap/untap convention to avoid spurious trigger fan-out.
   */
  *unattach(
    sourceId: EntityId,
    reason: "sba" | "targetLeft" | "effect" = "effect",
  ): Generator<EngineYield, void, unknown> {
    const source = this.game.cards.get(sourceId);
    // Pre-check: no intent, no replacement chain, no event.
    if (!source || source.attachedTo === null) return;
    const intent: UnattachIntent = { kind: "unattach", sourceId, reason };
    yield* this.applyWithReplacements<UnattachIntent>(
      intent,
      (final) => {
        const s = this.game.cards.get(final.sourceId);
        if (!s) return;
        const prev = s.attachedTo;
        if (prev === null) return;
        const target = this.game.cards.get(prev);
        if (target) {
          target.attachments = target.attachments.filter((x) => x !== final.sourceId);
        }
        s.attachedTo = null;
        // Task 43 — remove any per-attachment Layer 6 grants BEFORE
        // the bump so the cache repopulates without the stale effects.
        this.game.auraGrantLedger.onUnattach(this.game, final.sourceId);
        this.game.layerEngine.bumpEpoch("unattach");
      },
      (final) =>
        mkEvent("CardUnattached", this.game.turn, this.game.phase, {
          sourceId: final.sourceId,
          reason: final.reason,
        }),
    );
  }

  // === Activated ability ===

  /**
   * Activate ability `abilityIndex` on `cardId` on behalf of
   * `controllerSeat`. Validates zone + controller, pays the cost, builds
   * and pushes a StackItem of kind "activatedAbility", and returns the
   * new StackItem's id. See ability/activate.ts for the full contract.
   *
   * MVP: no-target activated abilities only (Llanowar Elves, etc.).
   * Targeted activated abilities (equip, etc.) are deferred to SP3+.
   */
  *activateAbility(
    cardId: EntityId,
    abilityIndex: number,
    controllerSeat: PlayerSeat,
  ): Generator<EngineYield, EntityId, unknown> {
    return yield* activateAbilityImpl(this.game, cardId, abilityIndex, controllerSeat);
  }

  // === Stack push ===

  *putOnStack(item: StackItem): Generator<EngineYield, void, unknown> {
    const game = this.game;
    // WHY no replacement routing: CR 614 replacement effects apply to
    // "events" — game-state mutations — not to stack bookkeeping. Stack
    // placement of a spell/ability happens as part of the cast process
    // (CR 601), which has its own intercept points (cast restrictions,
    // counterspells). Re-intercepting stack push through the replacement
    // chain would double-dip.
    game.sharedZones.stack.push(item);
    if (item.kind === "spell" || item.kind === "copy") {
      yield game.emitEvent(
        mkEvent("SpellPutOnStack", game.turn, game.phase, {
          stackItemId: item.id,
          cardId: item.sourceCardId,
          controllerSeat: item.controllerSeat,
        }),
      );
    } else {
      yield game.emitEvent(
        mkEvent("AbilityActivated", game.turn, game.phase, {
          stackItemId: item.id,
          sourceCardId: item.sourceCardId,
          controllerSeat: item.controllerSeat,
          abilityKind: "activated",
        }),
      );
    }
  }

  // === Mill + shuffle (SP1 implemented) ===

  *mill(seat: PlayerSeat, count: number): Generator<EngineYield, void, unknown> {
    const game = this.game;
    const player = game.getPlayer(seat);
    const library = player.zones.get(Zt.Library);
    if (!library) throw new GameStateIntegrityError(`Player ${seat} has no Library zone`);
    const graveyard = player.zones.get(Zt.Graveyard);
    if (!graveyard) {
      throw new GameStateIntegrityError(`Player ${seat} has no Graveyard zone`);
    }
    // Per-card intents so each mill card is an individual replacement
    // event (mirror of per-card drawCards — "if you would mill a card,
    // instead …" is a per-card hook).
    for (let i = 0; i < count; i++) {
      const topId = library.peekAt(0);
      if (topId === undefined) return;
      const intent: MillIntent = { kind: "mill", seat, count: 1 };
      yield* this.applyWithReplacements<MillIntent>(
        intent,
        (_final) => {
          const removed = library.removeAt(0);
          if (removed === undefined) return;
          graveyard.add(removed);
          const card = game.cards.get(removed);
          if (card) card.zone = Zt.Graveyard;
        },
        (_final) =>
          mkEvent("CardMilled", game.turn, game.phase, {
            playerSeat: seat,
            cardId: topId,
          }),
      );
    }
  }

  // WHY: SP1 shuffle emits no event (no LibraryShuffled in the canonical
  // event set); the generator shape is preserved so PhaseHandler can drive
  // it uniformly via yield*. Shuffle is also NOT a replacement target: CR
  // 701.20 defines shuffling as a substep of other events, not an event
  // itself, so there's no intercept point here.
  // biome-ignore lint/correctness/useYield: emits no event kind
  *shuffle(seat: PlayerSeat): Generator<EngineYield, void, unknown> {
    const game = this.game;
    const player = game.getPlayer(seat);
    const library = player.zones.get(Zt.Library);
    if (!library) throw new GameStateIntegrityError(`Player ${seat} has no Library zone`);
    // WHY: Zone doesn't expose set(); we snapshot, clear, and re-add in the
    // shuffled order so the internal items array reflects the rng-driven
    // permutation deterministically.
    const current = library.toArray();
    const shuffled = game.rng.shuffle(current);
    library.clear();
    for (const id of shuffled) library.add(id);
  }

  // === SP2/SP3 stubs ===

  // WHY: SP2/SP3 stubs. The `function*` keyword alone makes these generators;
  // no yield statement is needed because execution throws before returning.
  // Callers must invoke .next() to trigger the throw (generators don't run
  // their body on construction). biome-ignore on each stub because
  // correctness/useYield doesn't account for always-throw bodies.

  // === SP2 Milestone W — scry / surveil / proliferate / tokens / emblems ===

  /**
   * CR 701.20 — reveal the top N cards of the player's library, let them
   * partition the revealed set between top-of-library and bottom-of-library,
   * then re-seat the cards accordingly. The existing `scry` DecisionRequest
   * kind (core/player-decisions) carries `cards: readonly EntityId[]`; the
   * response partitions into `{ toTop, toBottom }`. The engine validates the
   * partition covers exactly the revealed set.
   *
   * Cards are pulled off the top BEFORE the decision so replacements that
   * fire later (in bottom-insertion, unusual) see the intermediate state.
   * SP2 emits one CardScried per revealed card AFTER re-seating — the event
   * shape lives on core's `Scry` event family (Task 12).
   */
  *scry(seat: PlayerSeat, count: number): Generator<EngineYield, void, unknown> {
    const game = this.game;
    const player = game.getPlayer(seat);
    const library = player.zones.get(Zt.Library);
    if (!library) throw new GameStateIntegrityError(`scry: library missing for seat ${seat}`);
    if (!Number.isInteger(count) || count <= 0) {
      throw new IllegalDecisionError(`scry: count must be a positive integer, got ${count}`);
    }
    const revealed: EntityId[] = [];
    for (let i = 0; i < count; i++) {
      const id = library.peekAt(0);
      if (id === undefined) break;
      library.removeAt(0);
      revealed.push(id);
    }
    if (revealed.length === 0) return;
    const rawResponse = yield {
      kind: "decision",
      request: { kind: "scry", playerSeat: seat, cards: revealed },
    };
    const response = rawResponse as DecisionResponse;
    if (response.kind !== "scry") {
      throw new IllegalDecisionError(`scry: expected scry response, got ${response.kind}`);
    }
    const { toTop, toBottom } = response;
    if (toTop.length + toBottom.length !== revealed.length) {
      throw new IllegalDecisionError(
        `scry: partition size ${toTop.length + toBottom.length} !== revealed ${revealed.length}`,
      );
    }
    const all = new Set<EntityId>([...toTop, ...toBottom]);
    for (const r of revealed) {
      if (!all.has(r))
        throw new IllegalDecisionError(`scry: partition missing card ${r as unknown as number}`);
    }
    if (all.size !== revealed.length) {
      throw new IllegalDecisionError("scry: partition contains duplicate ids");
    }
    // Re-seat top (first id ends up topmost). addToTop is O(n) per call; for
    // SP2's expected scry counts (1–5) that is negligible.
    for (let i = toTop.length - 1; i >= 0; i--) {
      const tid = toTop[i];
      if (tid !== undefined) library.addToTop(tid);
    }
    // Bottom: add at items.length (default) in the caller-supplied order.
    for (const bid of toBottom) {
      library.add(bid);
    }
    yield {
      kind: "event",
      event: mkEvent("Scry", game.turn, game.phase, {
        playerSeat: seat,
        count: revealed.length,
      }),
    };
  }

  /**
   * CR 701.44 — surveil mirrors scry but partitions into top-of-library and
   * owner's graveyard. Re-uses the existing `surveil` DecisionRequest kind
   * (cards revealed → `{ toTop, toGraveyard }` response). Cards moving to
   * the graveyard go through the same zone-change bookkeeping (Card.zone
   * update + Zone.add) — they are NOT routed through applyWithReplacements
   * because surveil itself is not a zone-change-causing event for each card
   * individually (the event chain collapses to CardSurveiled per CR 701.44c).
   */
  *surveil(seat: PlayerSeat, count: number): Generator<EngineYield, void, unknown> {
    const game = this.game;
    const player = game.getPlayer(seat);
    const library = player.zones.get(Zt.Library);
    const graveyard = player.zones.get(Zt.Graveyard);
    if (!library) throw new GameStateIntegrityError(`surveil: library missing for seat ${seat}`);
    if (!graveyard) throw new GameStateIntegrityError(`surveil: graveyard missing for seat ${seat}`);
    if (!Number.isInteger(count) || count <= 0) {
      throw new IllegalDecisionError(`surveil: count must be a positive integer, got ${count}`);
    }
    const revealed: EntityId[] = [];
    for (let i = 0; i < count; i++) {
      const id = library.peekAt(0);
      if (id === undefined) break;
      library.removeAt(0);
      revealed.push(id);
    }
    if (revealed.length === 0) return;
    const rawResponse = yield {
      kind: "decision",
      request: { kind: "surveil", playerSeat: seat, cards: revealed },
    };
    const response = rawResponse as DecisionResponse;
    if (response.kind !== "surveil") {
      throw new IllegalDecisionError(`surveil: expected surveil response, got ${response.kind}`);
    }
    const { toTop, toGraveyard } = response;
    if (toTop.length + toGraveyard.length !== revealed.length) {
      throw new IllegalDecisionError(
        `surveil: partition size ${toTop.length + toGraveyard.length} !== revealed ${revealed.length}`,
      );
    }
    const all = new Set<EntityId>([...toTop, ...toGraveyard]);
    for (const r of revealed) {
      if (!all.has(r)) {
        throw new IllegalDecisionError(`surveil: partition missing card ${r as unknown as number}`);
      }
    }
    if (all.size !== revealed.length) {
      throw new IllegalDecisionError("surveil: partition contains duplicate ids");
    }
    for (let i = toTop.length - 1; i >= 0; i--) {
      const tid = toTop[i];
      if (tid !== undefined) library.addToTop(tid);
    }
    for (const gid of toGraveyard) {
      graveyard.add(gid);
      const card = game.cards.get(gid);
      if (card) card.zone = Zt.Graveyard;
    }
    yield {
      kind: "event",
      event: mkEvent("Surveil", game.turn, game.phase, {
        playerSeat: seat,
        count: revealed.length,
      }),
    };
  }

  /**
   * CR 701.25 — proliferate: choose any number of permanents or players that
   * already have counters; on each, add one more counter of a kind already
   * present (if multiple kinds, controller picks which kind per target).
   *
   * SP2 scope: enumerate eligible cards (permanents with counter Maps of
   * nonzero size), yield a single `chooseProliferateTargets` decision, then
   * add counters via `addCounter` so replacement chains fire. Player counters
   * (poison/energy/experience) are modeled via Player.counters: proliferate
   * mutates them directly (no MutationIntent exists for player-counter
   * addition in SP2); a richer routing is SP3.
   */
  *proliferate(controllerSeat: PlayerSeat): Generator<EngineYield, void, unknown> {
    const game = this.game;
    const eligibleCards: EntityId[] = [];
    for (const [id, card] of game.cards) {
      if (card.zone === Zt.Battlefield && card.counters.size > 0) eligibleCards.push(id);
    }
    const eligiblePlayers: PlayerSeat[] = [];
    for (const p of game.players) {
      if (p.counters.size > 0) eligiblePlayers.push(p.seat);
    }
    if (eligibleCards.length === 0 && eligiblePlayers.length === 0) return;
    const rawResponse = yield {
      kind: "decision",
      request: {
        kind: "chooseProliferateTargets",
        playerSeat: controllerSeat,
        eligibleCards,
        eligiblePlayers,
      },
    };
    const response = rawResponse as DecisionResponse;
    if (response.kind !== "chooseProliferateTargets") {
      throw new IllegalDecisionError(
        `proliferate: expected chooseProliferateTargets response, got ${response.kind}`,
      );
    }
    const { chosenCards, chosenPlayers, counterChoices } = response;
    // Validate every chosen card is eligible.
    const eligibleCardSet = new Set(eligibleCards);
    for (const cid of chosenCards) {
      if (!eligibleCardSet.has(cid)) {
        throw new IllegalDecisionError(
          `proliferate: chosen card ${cid as unknown as number} not in eligible set`,
        );
      }
    }
    const eligiblePlayerSet = new Set(eligiblePlayers);
    for (const ps of chosenPlayers) {
      if (!eligiblePlayerSet.has(ps)) {
        throw new IllegalDecisionError(
          `proliferate: chosen player seat ${ps as unknown as number} not in eligible set`,
        );
      }
    }
    // Add one counter per chosen card.
    for (const cid of chosenCards) {
      const card = game.cards.get(cid);
      if (!card) continue;
      const chosenKind = counterChoices[`c:${cid as unknown as number}`];
      // When no explicit choice is supplied, fall back to the first counter
      // kind currently on the card (validated against the live Map). When
      // the card has exactly one counter kind, CR 701.25a implies no choice
      // is needed; this fallback handles both cases.
      const kindStr = chosenKind ?? [...card.counters.keys()][0];
      if (kindStr === undefined) continue;
      if (!card.counters.has(kindStr as CounterType)) {
        throw new IllegalDecisionError(
          `proliferate: counter kind '${String(kindStr)}' not on card ${cid as unknown as number}`,
        );
      }
      yield* this.addCounter(cid, kindStr as CounterType, 1);
    }
    // Player counters — mutate directly, bump layer epoch, emit a
    // CounterAdded canonical event via game.emitEvent. SP2's layer engine
    // doesn't yet scope player counters, but the epoch bump is defensive
    // and cheap.
    for (const seat of chosenPlayers) {
      const p = game.getPlayer(seat);
      const chosenKind = counterChoices[`p:${seat as unknown as number}`];
      const kindStr = chosenKind ?? [...p.counters.keys()][0];
      if (kindStr === undefined) continue;
      if (!p.counters.has(kindStr as CounterType)) {
        throw new IllegalDecisionError(
          `proliferate: counter kind '${String(kindStr)}' not on player seat ${seat as unknown as number}`,
        );
      }
      const current = p.counters.get(kindStr as CounterType) ?? 0;
      p.counters.set(kindStr as CounterType, current + 1);
      game.layerEngine.bumpEpoch("proliferate-player-counter");
    }
  }

  /**
   * CR 111 / 701.8 — create N tokens with identical characteristics. The
   * PaperCard supplies the token's identity (name, type line, P/T, etc.);
   * callers building non-paper tokens (Treasure, Food, Clue) wrap a
   * paper-shaped object. Returns the minted EntityIds so callers can track
   * them (e.g. to apply ETB replacements, re-query for triggers).
   *
   * The factory runs OUTSIDE applyWithReplacements because token creation
   * is not itself a MutationIntent kind — it is a cast-analog that enters
   * the battlefield directly. ETB replacements (Task 18) fire via the
   * subsequent CardChangedZone/TokenCreated events downstream in SP3's
   * full ETB pipeline.
   */
  *createToken(params: {
    readonly paperCard: PaperCard;
    readonly controller: PlayerSeat;
    readonly count: number;
    readonly isCopy?: boolean;
    readonly copyOf?: EntityId;
  }): Generator<EngineYield, readonly EntityId[], unknown> {
    const game = this.game;
    if (!Number.isInteger(params.count) || params.count <= 0) {
      throw new IllegalDecisionError(`createToken: count must be a positive integer, got ${params.count}`);
    }
    const ids: EntityId[] = [];
    for (let i = 0; i < params.count; i++) {
      const id = game.newEntityId();
      const card = new Card(id, params.paperCard, params.controller, params.controller, Zt.Battlefield);
      card.isToken = true;
      // Audit I-14 — CR 613.7 timestamp.
      card.timestamp = game.newCardTimestamp();
      if (params.isCopy === true && params.copyOf !== undefined) {
        const original = game.cards.get(params.copyOf);
        if (original) {
          // SP2 Milestone P already models CopiableCharacteristics on Card;
          // capture the source's copiable snapshot if it exists. When the
          // source has no copiedFrom, SP3 will populate a full snapshot.
          card.copiedFrom = original.copiedFrom;
        }
      }
      game.cards.set(id, card);
      // Wave 17b — populate spellAbilities from the token's CardDefinition
      // so artifact tokens (Treasure / Food / Clue / Blood / Powerstone)
      // have their activated abilities reachable via activateAbility().
      // No-op for cosmetic creature tokens whose `definition.abilities`
      // is empty.
      card.activateAbilitiesFromDefinition();
      const bf = game.getPlayer(params.controller).zones.get(Zt.Battlefield);
      if (!bf) {
        throw new GameStateIntegrityError(
          `createToken: battlefield zone missing for seat ${params.controller as unknown as number}`,
        );
      }
      bf.add(id);
      game.layerEngine.bumpEpoch("token-create");
      yield {
        kind: "event",
        event: mkEvent("TokenCreated", game.turn, game.phase, {
          controllerSeat: params.controller,
          tokenCardId: id,
        }),
      };
      ids.push(id);
    }
    return ids;
  }

  /**
   * CR 114 — create an emblem for a player. Emblems live in the command zone
   * and are identified by name + their granted static abilities. SP2 models
   * them as Card instances with `isEmblem = true`; SP3 may refactor to a
   * dedicated Emblem type once the static registry supports non-card-scoped
   * effect sources.
   */
  *createEmblem(params: {
    readonly ownerSeat: PlayerSeat;
    readonly paperCard: PaperCard;
    readonly grantedStatics?: readonly StaticAbility[];
  }): Generator<EngineYield, EntityId, unknown> {
    const game = this.game;
    const id = game.newEntityId();
    const card = new Card(id, params.paperCard, params.ownerSeat, params.ownerSeat, Zt.Command);
    card.isEmblem = true;
    if (params.grantedStatics !== undefined) {
      card.intrinsicStatics = params.grantedStatics;
    }
    game.cards.set(id, card);
    const cmd = game.getPlayer(params.ownerSeat).zones.get(Zt.Command);
    if (!cmd) {
      throw new GameStateIntegrityError(
        `createEmblem: command zone missing for seat ${params.ownerSeat as unknown as number}`,
      );
    }
    cmd.add(id);
    game.layerEngine.bumpEpoch("emblem-create");
    yield {
      kind: "event",
      event: mkEvent("TokenCreated", game.turn, game.phase, {
        controllerSeat: params.ownerSeat,
        tokenCardId: id,
      }),
    };
    return id;
  }

  // === Loop-detection shortcut (SP2 Task 66) ===

  /**
   * CR 725 — consumer-requested loop shortcut. Validates the descriptor,
   * emits ShortcutApplied, and (in SP2) trusts the consumer's finalState.
   * SP5 layers the apply-path on top.
   */
  *requestShortcut(description: string, result: LoopShortcutResult): Generator<EngineYield, void, unknown> {
    yield* loopRequestShortcut(this.game, description, result);
  }

  // === Helpers ===

  private locate(cardId: EntityId): { fromZone: ZoneType; owner: PlayerSeat | null } {
    // WHY: Stack is deliberately omitted here. Stack items are rich
    // StackItem records (not EntityIds); moving a card OFF the stack happens
    // inside resolveStackItem (SP2+), which pops the StackItem and then
    // moves the underlying source card through its own path. Searching
    // Stack via Card EntityId would require a bespoke helper and is not
    // used by any SP1 callers.
    const game = this.game;
    if (game.sharedZones.exile.contains(cardId)) {
      return { fromZone: Zt.Exile, owner: null };
    }
    if (game.sharedZones.ante.contains(cardId)) {
      return { fromZone: Zt.Ante, owner: null };
    }
    for (const player of game.players) {
      for (const zone of player.zones.values()) {
        if (zone.contains(cardId)) {
          return { fromZone: zone.type, owner: player.seat };
        }
      }
    }
    throw new GameStateIntegrityError(`Card ${cardId} not found in any zone`);
  }

  private zoneFor(t: ZoneType, owner: PlayerSeat | null): Zone {
    const game = this.game;
    if (owner === null) {
      // WHY: Stack is not a Zone subclass; moving a card directly to the
      // stack isn't supported through moveTo — callers construct a
      // StackItem and use putOnStack() instead.
      if (t === Zt.Stack) {
        throw new GameStateIntegrityError("GameAction.moveTo: cannot move to Stack directly; use putOnStack");
      }
      if (t === Zt.Exile) return game.sharedZones.exile;
      if (t === Zt.Ante) return game.sharedZones.ante;
      throw new GameStateIntegrityError(`Zone ${t} requires an owner`);
    }
    const zone = game.getPlayer(owner).zones.get(t);
    if (!zone) throw new GameStateIntegrityError(`Player ${owner} has no zone ${t}`);
    return zone;
  }

  private defaultDestinationSeat(
    toZone: ZoneType,
    fromOwner: PlayerSeat | null,
    cardId?: EntityId,
  ): PlayerSeat | null {
    // CR 400.7 — when a card changes zones to a zone owned by a specific
    // player (Hand, Graveyard, Library, Command, Sideboard, Planar...),
    // that zone is the OWNER's, not the controller's. Destroying a
    // creature an opponent stole from you puts the card in YOUR
    // graveyard, not theirs. Battlefield is the exception — there, the
    // entering controller (which may be opts.toSeat from a cast) is
    // authoritative.
    //
    // WHY shared zones (Exile, Ante, Stack) return null: they have no
    // per-player partitioning; the Zone instance is game-scoped.
    if (toZone === Zt.Exile || toZone === Zt.Ante || toZone === Zt.Stack) return null;
    if (cardId !== undefined) {
      const card = this.game.cards.get(cardId);
      if (card) {
        if (toZone === Zt.Battlefield) return card.controllerSeat;
        return card.ownerSeat;
      }
    }
    // Fallback: if the card record isn't resolvable (shouldn't happen on
    // an in-flight moveTo), keep the old behavior of routing to the
    // source-zone owner. Avoids crashes on exotic SBA synthesis paths.
    return fromOwner;
  }
}
