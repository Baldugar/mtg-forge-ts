// SPDX-License-Identifier: GPL-3.0-or-later
// SP2 Milestone K Task 43 — per-attachment Layer 6 ability grants.
//
// When an Aura (or similar ability-granting attachment like Equipment)
// attaches to a target, any intrinsic ability-granting statics it carries
// with the `targetsAttached: true` flag produce derived Layer 6
// AbilityChangeEffect entries scoped to the attached target via the
// `targetCardId` field. On unattach the entries are removed.
//
// WHY a ledger rather than a direct Layer 6 contribution at static-
// registration time: static registration fires on zone activation
// (statics/zone-activation.ts) BEFORE the aura has a target — the
// attached-to card is only known after the attach mutation lands. A
// static registered at ETB cannot encode the target id in its payload
// because describe() is stable and memoized (Task 28's layer-contributor
// contract). The ledger bridges the gap by cloning each ability-grant
// effect at attach-time with `targetCardId` set, then splicing them
// out on unattach.
//
// Stability contract: the derived effects stored in `byAura` are the
// SAME object references pushed into `layerEngine.abilityEffects`.
// onUnattach removes by array.indexOf, matching the referential-equality
// contract in layer-dispatch.ts.
//
// Forge reference: GameAction.attachTo / unattachFromCard drives
// StaticAbilityLayer recompute; our equivalent fires the ledger
// inside GameAction.attach/unattach.
import type { EntityId, StaticAbility } from "@mtg-forge-ts/core";
import type { Game } from "../game.js";
import type { AbilityChangeEffect } from "../layers/layer6-ability.js";

// Shape of an ability-granting static's describe() payload that opts
// into per-attachment grant behavior. The `targetsAttached: true` flag
// distinguishes per-attachment grants from global grants (Layer 6
// statics that grant to every matching permanent regardless of
// attachment). Consumers cast describe()'s `unknown` return to this
// shape; an absent or `false` `targetsAttached` field means "global".
export interface AuraAbilityGrantPayload {
  readonly kind: "ability";
  readonly effect: AbilityChangeEffect;
  readonly targetsAttached?: boolean;
}

export class AuraAbilityGrantLedger {
  // auraCardId → list of derived AbilityChangeEffect references currently
  // living in game.layerEngine.abilityEffects. Identity-keyed so removal
  // can splice the exact entries back out.
  private readonly byAura = new Map<EntityId, AbilityChangeEffect[]>();

  /**
   * Called after a successful attach mutation. Walks the source card's
   * intrinsic statics; for each ability-granting static flagged
   * `targetsAttached: true`, clones its effect with `targetCardId` set
   * to the attached target and pushes it onto the Layer 6 array.
   *
   * Idempotent: calling onAttach again for the same sourceId (e.g.,
   * after a re-attach to a different target) first clears the prior
   * ledger entries so the fresh target's effects replace them.
   */
  onAttach(game: Game, auraId: EntityId, targetId: EntityId): void {
    // Clear prior entries first — re-attach without a prior onUnattach
    // would otherwise leave stale effects in the layer array.
    this.onUnattach(game, auraId);
    const aura = game.cards.get(auraId);
    if (!aura) return;
    const statics: readonly StaticAbility[] = aura.intrinsicStatics ?? [];
    const derived: AbilityChangeEffect[] = [];
    for (const s of statics) {
      if (s.category !== "abilityGranting" && s.category !== "continuous") continue;
      const payload = s.describe() as AuraAbilityGrantPayload;
      if (payload.kind !== "ability") continue;
      if (payload.targetsAttached !== true) continue;
      const e = payload.effect;
      // Clone to set targetCardId without mutating the static's original
      // effect record (which may be the same reference across attaches).
      switch (e.kind) {
        case "add":
          derived.push({ ...e, targetCardId: targetId });
          break;
        case "removeAll":
          derived.push({ ...e, targetCardId: targetId });
          break;
        case "loseAll":
          derived.push({ ...e, targetCardId: targetId });
          break;
        default: {
          const _: never = e;
          throw new Error(`AuraAbilityGrantLedger.onAttach: unreachable ${JSON.stringify(_)}`);
        }
      }
    }
    if (derived.length === 0) return;
    for (const e of derived) {
      game.layerEngine.abilityEffects.push(e);
    }
    this.byAura.set(auraId, derived);
    // Epoch bump is the caller's responsibility (GameAction.attach bumps
    // unconditionally so even a zero-derivation attach invalidates the
    // cache — an attachment change can still affect layer dependencies).
    // A redundant bump here wouldn't harm but would churn checkEpoch.
  }

  /**
   * Remove any derived Layer 6 entries previously registered for this
   * aura. Safe to call on an aura with no entries (no-op).
   */
  onUnattach(game: Game, auraId: EntityId): void {
    const derived = this.byAura.get(auraId);
    if (!derived || derived.length === 0) {
      this.byAura.delete(auraId);
      return;
    }
    for (const e of derived) {
      const i = game.layerEngine.abilityEffects.indexOf(e);
      if (i >= 0) game.layerEngine.abilityEffects.splice(i, 1);
    }
    this.byAura.delete(auraId);
  }

  /**
   * Test helper — peek at the derived effects currently tracked for an
   * aura. Returns an empty array if none are tracked.
   */
  entriesFor(auraId: EntityId): readonly AbilityChangeEffect[] {
    return this.byAura.get(auraId) ?? [];
  }
}
