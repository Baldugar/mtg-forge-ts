// SPDX-License-Identifier: GPL-3.0-or-later
// Wave 70.J — DisableTriggers static handler. CR 603.X / Forge's
// StaticAbilityDisableTriggers — suppresses trigger firings whose
// "cause" matches a filter (typically zone-changes of certain card
// types). Hushwing Gryff / Tocatli Honor Guard / Torpor Orb-shape
// statics live here.
//
// Forge cards using this:
//   - Hushwing Gryff               ("Creatures entering the battlefield
//                                    don't cause abilities to trigger.")
//   - Tocatli Honor Guard          (same shape; creature-specific)
//   - Torpor Orb / Hushbringer     ("Creatures entering the battlefield
//                                    don't cause abilities to trigger.")
//   - Cursed Totem-style emblem    (artifact / creature ETB suppression)
//   - Hexproof-bypass siblings     ("Ward abilities of those creatures
//                                    don't trigger." — VeluxX-shape)
//   - Permanent.OppCtrl scoped     ("Permanents entering don't cause
//                                    abilities of permanents your
//                                    opponents control to trigger.")
//
// DSL examples (top corpus shapes):
//   S:Mode$ DisableTriggers | ValidCause$ Creature
//                            | ValidMode$ ChangesZone,ChangesZoneAll
//                            | Destination$ Battlefield
//                            | Description$ ...
//
//   S:Mode$ DisableTriggers | ValidCause$ Permanent
//                            | ValidMode$ ChangesZone,ChangesZoneAll
//                            | Destination$ Battlefield
//                            | ValidCard$ Permanent.OppCtrl+inZoneBattlefield
//                            | Description$ ...
//
//   S:Mode$ DisableTriggers | ValidTrigger$ Triggered.Ward
//                            | ValidCard$ Creature.OppCtrl+inZoneBattlefield
//                            | Description$ ...
//
// What it does (Forge): when a triggered ability would fire because
// of an event whose cause-card / event-mode / origin / destination /
// trigger-source matches the filter, that fire is silently dropped.
// The trigger remains registered and will fire normally for non-
// matching events. This is a per-event suppression, NOT a per-trigger
// disable.
//
// Routing: ruleChanging category — already mapped in MODE_TO_CATEGORY.
// The describe() payload exposes per-field predicates; the gate
// consumer (isTriggerDisabled in wave70j-rule-gates.ts) is invoked
// from the trigger-registry's onEvent path before the trigger is
// pushed onto the pending queue.
//
// Wiring approach (snapshot-friendly): we walk the static registry
// per-event in trigger-registry.onEvent. This mirrors the Wave 60.A /
// 70.D-I gate pattern (registry-walk on each consult) — no
// suppressionFilter installation, so the gate works correctly
// post-snapshot-restore without re-installing closures.
//
// MVP scope:
//   - ValidCause$ <card filter>  — applied to event payload's cause card
//                                   (the card whose action triggered the
//                                   event, e.g. the creature that just
//                                   entered).
//   - ValidMode$ <comma list>    — restricts to specific trigger mode
//                                   strings (ChangesZone, ChangesZoneAll,
//                                   etc.). The matched trigger's
//                                   `ast.mode` is consulted at the gate.
//   - Destination$ <zone>        — restricts to events whose toZone
//                                   matches (e.g. Battlefield).
//   - Origin$ <zone>             — symmetric for fromZone.
//   - ValidCard$ <card filter>   — applied to the TRIGGER source card
//                                   (Hushwing's ValidCard$ "Permanent.
//                                   OppCtrl" — only suppresses
//                                   opponents' triggers).
//   - ValidTrigger$ <token>      — pattern-string match on the trigger's
//                                   `triggered:` annotation (Ward, etc.).
// TODO(advanced):
//   - ValidCause$ targeting a Player (not a card) — rare; default to
//     not-matched per MVP. Used by some pseudo-trigger blocks.
//   - Conditional sub-params (Secondary$ True, etc.) consulted
//     elsewhere in Forge — surfaced on payload but not enforced at the
//     gate.
import type { EntityId, ParamValue, StaticAbility, StaticAst } from "@mtg-forge-ts/core";
import { ZoneType } from "@mtg-forge-ts/core";
import type { Game } from "../../game.js";
import {
  StaticHandler,
  type StaticHandlerCtx,
  normalizeActiveInZones,
  staticHandlerRegistry,
} from "../static-handler.js";
import { buildCardIdPredicate, literalRaw } from "./restriction-helpers.js";

/**
 * Read-side payload exposing the per-field predicates the gate consults.
 * Each predicate is independent — the gate AND-combines all matched
 * predicates. An undefined predicate matches everything.
 *
 * Wave 97 — Origin$ / Destination$ now widen to a SET of zones so the
 * canonical Forge "Battlefield,Graveyard" composite parses end-to-end
 * (Cursed Totem-shape disabling triggers across multiple zones in one
 * S: line).
 */
export interface DisableTriggersPayload {
  readonly kind: "disableTriggers";
  /** Predicate on the EVENT'S CAUSE card (e.g. the creature that just ETB'd). */
  readonly causeMatches: ((cardId: EntityId, game: Game) => boolean) | undefined;
  /** Set of trigger mode strings (Forge "ValidMode$" comma-list). undefined → all modes. */
  readonly modes: ReadonlySet<string> | undefined;
  /** Set of permitted destination zones (toZone). undefined → any. */
  readonly destinations: ReadonlySet<ZoneType> | undefined;
  /** Set of permitted origin zones (fromZone). undefined → any. */
  readonly origins: ReadonlySet<ZoneType> | undefined;
  /** Predicate on the TRIGGER SOURCE CARD. undefined → any trigger source. */
  readonly triggerSourceMatches: ((cardId: EntityId, game: Game) => boolean) | undefined;
  /** Trigger-annotation pattern (e.g. "Triggered.Ward"). undefined → any annotation. */
  readonly triggerAnnotationRaw: string | undefined;
}

const splitCsv = (raw: string | undefined): ReadonlySet<string> | undefined => {
  if (raw === undefined || raw.length === 0) return undefined;
  return new Set(
    raw
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0),
  );
};

/**
 * Wave 97 — comma-separated zone list parser. Each token must be a
 * canonical ZoneType string ("Battlefield" / "Graveyard" / "Hand" /
 * etc.). Unknown tokens are dropped; an entirely-unknown list
 * collapses back to undefined (treated as "any zone"). The behavior
 * keeps malformed scripts permissive instead of fail-closed, matching
 * Forge's tolerant parser.
 */
const parseZoneSet = (raw: string | undefined): ReadonlySet<ZoneType> | undefined => {
  if (raw === undefined || raw.length === 0) return undefined;
  const known = new Set(Object.values(ZoneType) as string[]);
  const tokens = raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  const result = new Set<ZoneType>();
  for (const tok of tokens) {
    if (known.has(tok)) result.add(tok as ZoneType);
  }
  return result.size === 0 ? undefined : result;
};

export class DisableTriggersStaticHandler extends StaticHandler {
  static override readonly mode = "DisableTriggers" as const;

  override build(ast: StaticAst, ctx: StaticHandlerCtx): StaticAbility {
    const params: Readonly<Record<string, ParamValue>> = ast.params;

    const validCauseRaw = literalRaw(params.ValidCause);
    const causeMatches =
      validCauseRaw === undefined
        ? undefined
        : buildCardIdPredicate(validCauseRaw, ctx.sourceCardId, ctx.controllerSeat);

    const validCardRaw = literalRaw(params.ValidCard);
    const triggerSourceMatches =
      validCardRaw === undefined
        ? undefined
        : buildCardIdPredicate(validCardRaw, ctx.sourceCardId, ctx.controllerSeat);

    const modes = splitCsv(literalRaw(params.ValidMode));
    const destinations = parseZoneSet(literalRaw(params.Destination));
    const origins = parseZoneSet(literalRaw(params.Origin));
    const triggerAnnotationRaw = literalRaw(params.ValidTrigger);

    const payload: DisableTriggersPayload = {
      kind: "disableTriggers",
      causeMatches,
      modes,
      destinations,
      origins,
      triggerSourceMatches,
      triggerAnnotationRaw,
    };

    const activeInZones = normalizeActiveInZones(ast.activeInZones);
    return {
      id: ctx.staticId,
      kind: "static",
      sourceCardId: ctx.sourceCardId,
      activeInZones,
      timestamp: ctx.game.newEntityId(),
      controllerSeatAtReg: ctx.controllerSeat,
      category: "ruleChanging",
      mode: "DisableTriggers",
      describe: () => payload,
    };
  }
}

staticHandlerRegistry.register(DisableTriggersStaticHandler);
