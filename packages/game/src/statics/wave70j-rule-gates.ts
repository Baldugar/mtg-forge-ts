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
import type { EntityId, GameEvent, PlayerSeat, TriggeredAbility } from "@mtg-forge-ts/core";
import type { ZoneType } from "@mtg-forge-ts/core";
import type { Game } from "../game.js";
import type { CantAttackPayload } from "../static/handlers/cant-attack.js";
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
    // Wave 110 — IsPresent$ sub-conditional gate. Brothers Yamazaki's
    // exemption only applies when EQ2 copies are on the battlefield; if the
    // gate is unsatisfied the carve-out vanishes and the legend-rule SBA
    // fires normally on the matched bucket.
    if (!payload.isPresentSatisfied(game)) continue;
    if (payload.cardMatches(cardId, game)) return true;
  }
  return false;
};

/**
 * Wave 104 — read-side accessor: returns the UnlessCost$ text for the
 * first active CantAttack static matching `attackerId`, or undefined
 * if none / no cost is registered. Mirrors `cantBlockUnlessPaidCostText`
 * on the attack side: the validateAttackDeclarations sweep already
 * denies on a match (treating the unless-cost as unpaid), so this
 * helper exists for diagnostic UI surfacing and for the future
 * cost-payment dialog at attack-declaration time.
 */
export const cantAttackUnlessPaidCostText = (game: Game, attackerId: EntityId): string | undefined => {
  const statics = game.staticEffectRegistry.byMode("CantAttack");
  for (const s of statics) {
    const restriction = s.describe() as Restriction;
    if (!restriction.subjectFilter(attackerId, game)) continue;
    const payload = restriction.payload as CantAttackPayload | undefined;
    if (payload?.costText !== undefined) return payload.costText;
  }
  return undefined;
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

/**
 * Wave 100 — best-effort player-seat extractor for events whose cause
 * is canonically a player (LifeChanged, PlayerLost, MaybePoisonGain,
 * etc. — anything carrying a `playerSeat` in the payload). Returns
 * undefined for card-cause events so the player-cause filter is
 * skipped (the canonical card-cause filter still applies).
 */
const eventCausePlayerSeat = (event: GameEvent): PlayerSeat | undefined => {
  const payload = (event as { payload?: { playerSeat?: PlayerSeat } }).payload;
  return payload?.playerSeat;
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
 *   6. ValidTrigger$    — annotation pattern (Wave 104 — comma-OR token
 *                          alternatives via triggerAnnotationTokens; the
 *                          single-literal raw form is preserved for legacy
 *                          payload readers)
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
  const causePlayerSeat = eventCausePlayerSeat(event);
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
    // 2. Origin$ (Wave 97 widened to a set — composite
    //    "Battlefield,Graveyard" S: lines now match either zone).
    if (p.origins !== undefined) {
      if (origin === undefined || !p.origins.has(origin)) continue;
    }
    // 3. Destination$ (Wave 97 widened to a set — same shape as Origin$).
    if (p.destinations !== undefined) {
      if (destination === undefined || !p.destinations.has(destination)) continue;
    }
    // 4. ValidCause$ — require a cause card present and matching.
    if (p.causeMatches !== undefined) {
      if (causeCardId === undefined) continue;
      if (!p.causeMatches(causeCardId, game)) continue;
    }
    // 4b. Wave 100 — ValidCausePlayer$ — require a cause player present
    // and matching (LifeChanged / PlayerLost / similar player-event
    // shapes). When the static specifies BOTH ValidCause$ and
    // ValidCausePlayer$, the gate consults each predicate independently:
    // the card filter binds card-cause events; the player filter binds
    // player-cause events. Most events carry only one cause kind, so in
    // practice the two filters are alternatives.
    if (p.playerCauseMatches !== undefined) {
      if (causePlayerSeat === undefined) continue;
      if (!p.playerCauseMatches(causePlayerSeat)) continue;
    }
    // 5. ValidCard$ — restrict to triggers sourced by matching cards.
    if (p.triggerSourceMatches !== undefined) {
      if (!p.triggerSourceMatches(triggerSrcId, game)) continue;
    }
    // 6. ValidTrigger$ — annotation token match. Wave 104 broadens the
    // single-literal MVP to a comma-OR alternatives set: when Forge
    // writes "ValidTrigger$ Triggered.Ward,Triggered.Custom", any
    // token match fires the gate. The trigger's ast.params.Triggered
    // (when present) is duck-typed off the trigger object.
    if (p.triggerAnnotationTokens !== undefined) {
      const ast = (
        trigger as unknown as {
          ast?: { params?: Readonly<Record<string, { kind?: string; raw?: string }>> };
        }
      ).ast;
      const triggered = ast?.params?.Triggered?.raw;
      if (triggered === undefined) continue;
      if (!p.triggerAnnotationTokens.has(triggered)) continue;
    }
    return true;
  }
  return false;
};
