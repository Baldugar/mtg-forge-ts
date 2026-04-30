// SPDX-License-Identifier: GPL-3.0-or-later
// Wave 70.J — query helpers for the three Wave-70.J static modes:
//   - IgnoreLegendRule    → isExemptFromLegendRule
//   - CantBlockUnless     → cantBlockUnlessPaidCostText (read-side helper)
//   - DisableTriggers     → isTriggerDisabled
//
// Each helper walks the staticEffectRegistry by mode and returns a
// single value (boolean / metadata) the consumer site uses to override
// the canonical rules behavior at the matching decision point.
//
// Read-side consumers:
//   - isExemptFromLegendRule          → sba/legend-world.ts
//                                         (legend-rule SBA collector skips
//                                          matched cards before bucketing)
//   - cantBlockUnlessPaidCostText     → combat block-validation site (the
//                                         existing isBlockingRestricted
//                                         already returns true because
//                                         CantBlockUnless surfaces a
//                                         Restriction with kind cantBlock;
//                                         this helper exposes the cost
//                                         text for diagnostic / future
//                                         cost-payment integration)
//   - isTriggerDisabled               → triggers/trigger-registry.ts
//                                         onEvent path (called BEFORE
//                                         pushing onto pending queue;
//                                         silently drops matched fires)
//
// Why standalone helpers (not methods on Game / Game.flags): mirrors
// Wave 60.A / 60.H / 70.D / 70.E / 70.F / 70.I. The static registry
// already snapshots and restores cleanly, so walking the registry
// per-query is the right source of truth.
import type { EntityId, GameEvent, TriggeredAbility } from "@mtg-forge-ts/core";
import type { ZoneType } from "@mtg-forge-ts/core";
import type { Game } from "../game.js";
import type { CantBlockUnlessPayload } from "../static/handlers/cant-block-unless-static.js";
import type { DisableTriggersPayload } from "../static/handlers/disable-triggers-static.js";
import type { IgnoreLegendRulePayload } from "../static/handlers/ignore-legend-rule-static.js";
import type { Restriction } from "./cant-must-may.js";

/**
 * True iff `cardId` is exempt from the legend rule SBA (CR 704.5j) per
 * any active IgnoreLegendRule static. Consumed by collectLegendWorld
 * before bucketing legendaries by (controller, name) — exempt cards
 * are skipped entirely so the bucket they would have joined never
 * reaches the size-2 threshold solely because of them.
 *
 * Mirror Gallery (no filter) → exempts EVERY legendary permanent.
 * Sliver Legion (Sliver.YouCtrl) → exempts only matched cards.
 */
export const isExemptFromLegendRule = (game: Game, cardId: EntityId): boolean => {
  const statics = game.staticEffectRegistry.byMode("IgnoreLegendRule");
  for (const s of statics) {
    const payload = s.describe() as IgnoreLegendRulePayload;
    if (payload.cardMatches(cardId, game)) return true;
  }
  return false;
};

/**
 * Read-side accessor: returns the Cost$ text for the first active
 * CantBlockUnless static matching `blockerId`, or undefined if none.
 *
 * The block-validation site (combat-handler / block-restrictions) does
 * NOT consume this directly — the Wave 70.J handler emits a Restriction
 * with kind=cantBlock so the existing isBlockingRestricted sweep picks
 * it up automatically. This helper exists for diagnostic UI surfacing
 * and for future cost-payment integration that walks the unless-cost
 * payload at block-declaration time.
 */
export const cantBlockUnlessPaidCostText = (game: Game, blockerId: EntityId): string | undefined => {
  const statics = game.staticEffectRegistry.byMode("CantBlockUnless");
  for (const s of statics) {
    const restriction = s.describe() as Restriction;
    if (!restriction.subjectFilter(blockerId, game)) continue;
    const payload = restriction.payload as CantBlockUnlessPayload | undefined;
    if (payload?.costText !== undefined) return payload.costText;
  }
  return undefined;
};

/**
 * Inputs to isTriggerDisabled — the trigger-registry's onEvent path
 * supplies the live (trigger, event, cause) tuple. We accept the
 * trigger via its ast.mode + sourceCardId only (DTO surface) to avoid
 * coupling this module to the full TriggeredAbility interface; the
 * registry passes the trigger object verbatim.
 */
const eventCauseCardId = (event: GameEvent): EntityId | undefined => {
  // Best-effort: most cause-card events carry a `cardId` in the
  // payload (CardEntered, CardChangedZone, CardCast, etc.). Other
  // events (LifeChanged, TurnEnded, etc.) have no card cause; the
  // gate's causeMatches predicate will return false / be skipped.
  const payload = (event as { payload?: { cardId?: EntityId } }).payload;
  return payload?.cardId;
};

const eventOrigin = (event: GameEvent): ZoneType | undefined => {
  if (event.kind !== "CardChangedZone") return undefined;
  return event.payload.fromZone;
};

const eventDestination = (event: GameEvent): ZoneType | undefined => {
  if (event.kind !== "CardChangedZone") return undefined;
  return event.payload.toZone;
};

const triggerMode = (trigger: TriggeredAbility): string | undefined => {
  // TriggeredAbility carries an `ast.mode` slot (ChangesZone /
  // ChangesZoneAll / Phase / etc.). The interface uses `unknown` for
  // forward-compat shapes, so we duck-type the lookup defensively.
  const ast = (trigger as unknown as { ast?: { mode?: unknown } }).ast;
  if (!ast || typeof ast.mode !== "string") return undefined;
  return ast.mode;
};

/**
 * True iff the (trigger, event) pair is suppressed by any active
 * DisableTriggers static. The trigger-registry's onEvent path consults
 * this BEFORE pushing onto the pending queue — matched fires are
 * silently dropped (no PendingTrigger entry, no APNAP ordering).
 *
 * Match logic (AND across non-undefined predicates):
 *   1. ValidMode$       — trigger's ast.mode in the static's modes set
 *   2. Origin$          — event's fromZone == static's origin (zone-change only)
 *   3. Destination$     — event's toZone == static's destination (zone-change only)
 *   4. ValidCause$      — event's cause card matches the predicate
 *   5. ValidCard$       — trigger's source card matches the predicate
 *   6. ValidTrigger$    — annotation pattern (TODO(advanced) deeper pattern check)
 *
 * MVP semantics: for Hushwing-shape statics (ValidCause$ Creature +
 * ValidMode$ ChangesZone,ChangesZoneAll + Destination$ Battlefield),
 * any creature ETB event will short-circuit ALL ETB triggers fired by
 * that event, regardless of which card owns the trigger. The
 * ValidCard$ filter (when present) further restricts to triggers
 * sourced by matching cards (Permanent.OppCtrl scoping).
 */
export const isTriggerDisabled = (game: Game, trigger: TriggeredAbility, event: GameEvent): boolean => {
  const statics = game.staticEffectRegistry.byMode("DisableTriggers");
  if (statics.length === 0) return false;

  const causeCardId = eventCauseCardId(event);
  const origin = eventOrigin(event);
  const destination = eventDestination(event);
  const tMode = triggerMode(trigger);
  const triggerSrcId = trigger.sourceCardId;

  for (const s of statics) {
    const p = s.describe() as DisableTriggersPayload;
    // 1. ValidMode$
    if (p.modes !== undefined) {
      if (tMode === undefined || !p.modes.has(tMode)) continue;
    }
    // 2. Origin$
    if (p.origin !== undefined) {
      if (origin !== p.origin) continue;
    }
    // 3. Destination$
    if (p.destination !== undefined) {
      if (destination !== p.destination) continue;
    }
    // 4. ValidCause$ — require a cause card present and matching.
    if (p.causeMatches !== undefined) {
      if (causeCardId === undefined) continue;
      if (!p.causeMatches(causeCardId, game)) continue;
    }
    // 5. ValidCard$ — restrict to triggers sourced by matching cards.
    if (p.triggerSourceMatches !== undefined) {
      if (!p.triggerSourceMatches(triggerSrcId, game)) continue;
    }
    // 6. ValidTrigger$ — exact-match annotation surface (MVP). The
    // Forge "Triggered.Ward" / "Triggered.Custom" surface is exposed
    // via the trigger's ast.params.Triggered (when present); we
    // duck-type the read.
    if (p.triggerAnnotationRaw !== undefined) {
      const ast = (
        trigger as unknown as {
          ast?: { params?: Readonly<Record<string, { kind?: string; raw?: string }>> };
        }
      ).ast;
      const triggered = ast?.params?.Triggered?.raw;
      if (triggered !== p.triggerAnnotationRaw) continue;
    }
    return true;
  }
  return false;
};
