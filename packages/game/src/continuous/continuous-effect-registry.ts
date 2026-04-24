// SPDX-License-Identifier: GPL-3.0-or-later
// ContinuousEffectRegistry — registry for CR 611 time-limited continuous
// effects. Surface mirrors StaticEffectRegistry (register/unregister by id)
// but adds expiry logic driven by events + epoch bumps.
//
// Lifecycle:
//   register(effect)
//     - store in id-indexed map
//     - mirror into game.continuousEffects (snapshot compat)
//     - push the layer-specific payload into the matching LayerEngine
//       array via layer-dispatch.ts (shared with StaticEffectRegistry)
//     - bump LayerEngine epoch
//   unregister(id)
//     - drop from id map + game.continuousEffects
//     - splice payload out of the LayerEngine array
//     - bump LayerEngine epoch
//
// Expiry:
//   onEvent(event)
//     - iterate effects, ask isExpired for each; unregister + queue those
//       that expired. Enqueued effects drain via drainExpired().
//   checkEpoch() (Task 34 wiring)
//     - re-evaluate asLongAs effects after a layer re-computation. Kept
//       recursive-safe by NOT bumping the epoch again inside the iteration
//       (the unregister() bump is amortized against the outer bump that
//       triggered us; the pending-epoch guard in LayerEngine collapses
//       the two into one cache invalidation).
//
// The drain-buffer pattern keeps Game.emitEvent's contract intact: a single
// EngineYield is returned per call, and ContinuousEffectExpired events are
// yielded by the priority orchestrator (Milestone J) after it drains the
// buffer — not inlined into every mutating call site.
import type { ContinuousEffect, EntityId, GameEvent } from "@mtg-forge-ts/core";
import type { Game } from "../game.js";
import { type LayerPayload, pushLayerPayload, removeLayerPayload } from "../layers/layer-dispatch.js";
import { type ExpiryContext, isExpired } from "./duration-evaluator.js";

export class ContinuousEffectRegistry {
  private readonly byId = new Map<EntityId, ContinuousEffect>();
  // Buffer of effects that expired since the last drain. The priority
  // orchestrator (Milestone J) calls drainExpired() to yield one
  // ContinuousEffectExpired event per entry; between drains, the buffer
  // accumulates events fired by back-to-back mutations.
  private readonly expiredBuffer: ContinuousEffect[] = [];

  constructor(private readonly game: Game) {}

  register(effect: ContinuousEffect): void {
    // Re-register of same id: unwind first so the layer engine does not
    // accumulate duplicate payload references (same referential-equality
    // contract as StaticEffectRegistry).
    if (this.byId.has(effect.id)) this.unregister(effect.id);
    this.byId.set(effect.id, effect);
    // Mirror into game.continuousEffects for snapshot compat — the array
    // is the snapshot source of truth (GameSnapshot.state.continuousEffects).
    this.game.continuousEffects.push(effect);
    pushLayerPayload(this.game, effect.payload as LayerPayload);
    this.game.layerEngine.bumpEpoch("continuous-effect-register");
  }

  unregister(id: EntityId): void {
    const effect = this.byId.get(id);
    if (!effect) return;
    this.byId.delete(id);
    const idx = this.game.continuousEffects.findIndex((e) => e.id === id);
    if (idx >= 0) this.game.continuousEffects.splice(idx, 1);
    removeLayerPayload(this.game, effect.payload as LayerPayload);
    this.game.layerEngine.bumpEpoch("continuous-effect-unregister");
  }

  get(id: EntityId): ContinuousEffect | undefined {
    return this.byId.get(id);
  }

  all(): readonly ContinuousEffect[] {
    return [...this.byId.values()];
  }

  size(): number {
    return this.byId.size;
  }

  /**
   * Event-driven expiry check. Iterate the live set, unregister any
   * effects whose duration matched the event, and queue them for drain.
   *
   * Called by Game.emitEvent alongside trigger + delayed-trigger routing
   * so every canonical event gets a chance to expire time-limited effects.
   * Engine-internal events (ContinuousEffectRegistered/Expired themselves,
   * trigger pipeline telemetry) are filtered UPSTREAM so we do not need
   * a second allowlist here.
   */
  onEvent(event: GameEvent): void {
    this.expireMatching({ kind: "event", event });
  }

  /**
   * Epoch-bump expiry check. Wired into LayerEngine.bumpEpoch so asLongAs
   * effects re-evaluate their condition after any state change that
   * could invalidate it (Layer 4 type change, tap/untap, life change,
   * etc.). Re-entrancy is guarded inside bumpEpoch — an asLongAs
   * expiring here calls unregister, which bumps the epoch again, but
   * the guard short-circuits that nested bump's re-check.
   */
  checkEpoch(): void {
    this.expireMatching({ kind: "epochBump" });
  }

  private expireMatching(ctx: ExpiryContext): void {
    // Snapshot the id list before unregister() mutates byId. Iterating the
    // live map while mutating it would skip entries.
    const toExpire: ContinuousEffect[] = [];
    for (const e of this.byId.values()) {
      if (isExpired(e, ctx, this.game)) toExpire.push(e);
    }
    for (const e of toExpire) {
      this.unregister(e.id);
      this.expiredBuffer.push(e);
    }
  }

  /**
   * Drain the pending-expired buffer. Returns the drained effects so the
   * caller (priority orchestrator) can yield one ContinuousEffectExpired
   * event per entry. After drain, the buffer is empty.
   */
  drainExpired(): readonly ContinuousEffect[] {
    const out = [...this.expiredBuffer];
    this.expiredBuffer.length = 0;
    return out;
  }
}
