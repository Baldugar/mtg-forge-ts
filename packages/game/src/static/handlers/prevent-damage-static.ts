// SPDX-License-Identifier: GPL-3.0-or-later
// Wave 60.E — PreventAllDamage / PreventAllDamageBy / PreventAllDamageTo
// static handlers. CR 615 family. Three same-shape gates consulted at the
// damage-application decision point in GameAction.damage to short-circuit
// the canonical applyWithReplacements flow when an active static prevents
// the would-be damage.
//
// DSL shapes (Forge-fidelity):
//   S:Mode$ PreventAllDamage    | Description$ ...
//     Global Fog-shape statics; matches every damage event.
//
//   S:Mode$ PreventAllDamageBy  | ValidSource$ <filter> | Combat$ True/False?
//                               | Description$ ...
//     Filtered-source — Holy Day-shape ("Prevent all combat damage that
//     would be dealt this turn" via Combat$ True), Story Circle's chosen-
//     color source variant, "creatures don't deal combat damage" emblem
//     shapes, etc.
//
//   S:Mode$ PreventAllDamageTo  | ValidTarget$ <filter> | Combat$ True/False?
//                               | Description$ ...
//     Filtered-target — Worship-shape protection effects, Story Circle
//     (chosen color targets you), Defense Grid analogues.
//
// Forge model (StaticAbilityPreventDamage in forge-game): one logical
// static-ability mode receives ValidSource$ + ValidTarget$ + Combat$ +
// IsPresent$ params. We follow Wave 60 conventions and surface three
// distinct mode names sharing a single underlying handler implementation
// — one thin per-mode subclass each — so downstream `byMode(...)` walks
// remain intent-readable while the matching logic lives in one place.
//
// Routing: replacementGenerating category. The describe() payload exposes
// matchesEvent(sourceId, targetId, isCombat, game) returning true when the
// gate should fire. The consumer site (GameAction.damage) calls
// `wouldPreventDamage` (statics/wave60-damage-gates.ts) which walks all
// three modes and returns true if any matches; on match, GameAction.damage
// emits a DamagePrevented event and bails before any DamageDealt fires —
// matching Forge's "silent prevention" (no DamageDealt observers fire).
//
// MVP scope:
//   - ValidSource$ / ValidTarget$ filters via cardMatchesFilter (Wave 32
//     grammar) for card subjects + the four-token player filter (You /
//     Opponent / Player / Any) for player subjects.
//   - Combat$ True/False filter on isCombat.
//   - PreventionEffect$ N (prevent up to N rather than all) is
//     TODO(advanced): Forge's StaticAbilityPreventDamage has this for
//     "shield" semantics (Ajani Steadfast emblem-shape "prevent all but
//     1"). For Wave 60.E we hard-prevent on match (PreventionEffect$
//     missing or "True" — i.e. the Fog-shape / Holy-Day-shape full
//     prevention). Targeted "prevent the next N damage" stays on the
//     R:Event$ DamageDone replacement path it already lives on.
//   - IsPresent$ sub-conditional gate is TODO(advanced).
import type {
  EntityId,
  ParamValue,
  PlayerSeat,
  ReplacementAbility,
  StaticAbility,
  StaticAst,
} from "@mtg-forge-ts/core";
import type { Game } from "../../game.js";
import type { ReplacementGenPayload } from "../../statics/replacement-generating.js";
import {
  StaticHandler,
  type StaticHandlerCtx,
  normalizeActiveInZones,
  staticHandlerRegistry,
} from "../static-handler.js";
import { buildCardIdPredicate, buildPlayerPredicate, literalRaw } from "./restriction-helpers.js";

// Discriminate the damage event shape `wouldPreventDamage` passes us.
type DamageTargetKind = "creature" | "player" | "planeswalker" | "battle";

/**
 * Payload shared by all three Wave-60.E modes. Extends the
 * replacementGenerating envelope (mandatory category contract); the
 * `replacements` slot is intentionally empty — the gate is enforced at
 * the GameAction.damage call site rather than via a derived replacement
 * chain (mirrors Wave 60.A's CantPutCounter pattern: silent short-circuit
 * before applyWithReplacements runs).
 */
export interface PreventDamagePayload extends ReplacementGenPayload {
  /** Returns true iff this static prevents the supplied damage event. */
  readonly matchesEvent: (
    sourceId: EntityId,
    targetKind: DamageTargetKind,
    targetId: EntityId | PlayerSeat,
    isCombat: boolean,
    game: Game,
  ) => boolean;
}

// ---------------------------------------------------------------------------
// Param parsing — Combat$ True/False filter.
// ---------------------------------------------------------------------------
// Tri-valued: undefined (no filter), true (Combat$ True → only combat),
// false (Combat$ False → only non-combat). The matcher AND-combines with
// the source/target predicates.
const parseCombatFilter = (raw: string | undefined): boolean | undefined => {
  if (raw === undefined) return undefined;
  if (raw === "True" || raw === "true") return true;
  if (raw === "False" || raw === "false") return false;
  return undefined;
};

// ---------------------------------------------------------------------------
// Target predicate — supports both card and player target subjects.
// ---------------------------------------------------------------------------
// ValidTarget$ in Forge accepts mixed card/player tokens. We resolve at
// match-time: when the damage event is `targetKind: "player"` we consult
// the seat predicate; when it's a card kind (creature/planeswalker/battle)
// we consult the card predicate. Both predicates are derived from the
// same raw string at build time — the seat predicate is built from the
// four-token whitelist (You/Opponent/Player/Any) the rest are built
// against `cardMatchesFilter`.
//
// For the unfiltered `PreventAllDamage` mode the raw is undefined — both
// predicates default to always-true.
interface CompiledTargetPred {
  readonly cardPred: (cardId: EntityId, game: Game) => boolean;
  readonly seatPred: (seat: PlayerSeat) => boolean;
}

const buildTargetPredicate = (
  raw: string | undefined,
  sourceCardId: EntityId,
  controllerSeat: PlayerSeat,
): CompiledTargetPred => ({
  cardPred: buildCardIdPredicate(raw, sourceCardId, controllerSeat),
  seatPred: buildPlayerPredicate(raw, controllerSeat),
});

// ValidSource$ is always card-shaped (a damage source is always a card in
// Forge — emblems / players don't deal damage, their permanents do). We
// only need a card predicate.
const buildSourcePredicate = (
  raw: string | undefined,
  sourceCardId: EntityId,
  controllerSeat: PlayerSeat,
): ((cardId: EntityId, game: Game) => boolean) => buildCardIdPredicate(raw, sourceCardId, controllerSeat);

// ---------------------------------------------------------------------------
// Core handler — shared logic across the three mode subclasses.
// ---------------------------------------------------------------------------

interface BuildArgs {
  readonly mode: "PreventAllDamage" | "PreventAllDamageBy" | "PreventAllDamageTo";
}

const buildPreventDamage = (ast: StaticAst, ctx: StaticHandlerCtx, args: BuildArgs): StaticAbility => {
  const params: Readonly<Record<string, ParamValue>> = ast.params;
  const validSourceRaw = literalRaw(params.ValidSource);
  const validTargetRaw = literalRaw(params.ValidTarget);
  const combatRaw = literalRaw(params.Combat);
  const combatFilter = parseCombatFilter(combatRaw);

  const sourcePred = buildSourcePredicate(validSourceRaw, ctx.sourceCardId, ctx.controllerSeat);
  const targetPred = buildTargetPredicate(validTargetRaw, ctx.sourceCardId, ctx.controllerSeat);

  const matchesEvent = (
    sourceId: EntityId,
    targetKind: DamageTargetKind,
    targetId: EntityId | PlayerSeat,
    isCombat: boolean,
    game: Game,
  ): boolean => {
    // Combat$ filter — short-circuit when the isCombat flag does not
    // match the static's Combat$ param.
    if (combatFilter !== undefined && combatFilter !== isCombat) return false;

    // Source filter — every mode honors ValidSource$ if present (the
    // unfiltered PreventAllDamage simply has no ValidSource$, so the
    // predicate is always-true).
    if (!sourcePred(sourceId, game)) return false;

    // Target filter — split on targetKind. Player damage consults the
    // seat predicate; card-kind damage consults the card predicate.
    if (targetKind === "player") {
      if (typeof targetId !== "number") {
        // Defensive: a player target should always be a PlayerSeat. If a
        // numeric id slips through, fall through to seatPred(0) which
        // would mismatch — better to reject and let the canonical
        // damage path run.
        return false;
      }
      // PlayerSeat is a branded number; runtime check above narrowed
      // targetId to number, but TS still sees `EntityId | PlayerSeat`
      // here. Both are numeric brands so the seatPred call is safe.
      if (!targetPred.seatPred(targetId as PlayerSeat)) return false;
    } else {
      if (typeof targetId !== "number") return false;
      if (!targetPred.cardPred(targetId as EntityId, game)) return false;
    }

    return true;
  };

  const payload: PreventDamagePayload = {
    kind: "replacementGen",
    replacements: [] as readonly ReplacementAbility[],
    matchesEvent,
  };

  const activeInZones = normalizeActiveInZones(ast.activeInZones);
  return {
    id: ctx.staticId,
    kind: "static",
    sourceCardId: ctx.sourceCardId,
    activeInZones,
    timestamp: ctx.game.newEntityId(),
    controllerSeatAtReg: ctx.controllerSeat,
    category: "replacementGenerating",
    mode: args.mode,
    describe: () => payload,
  };
};

// ---------------------------------------------------------------------------
// Three mode-specific subclasses (registry maps one mode → one ctor).
// All three delegate to buildPreventDamage. The mode arg distinguishes
// the registered StaticAbility.mode tag so byMode(...) walks segregate
// cleanly even though the matching logic is identical.
// ---------------------------------------------------------------------------

export class PreventAllDamageStaticHandler extends StaticHandler {
  static override readonly mode = "PreventAllDamage" as const;

  override build(ast: StaticAst, ctx: StaticHandlerCtx): StaticAbility {
    return buildPreventDamage(ast, ctx, { mode: "PreventAllDamage" });
  }
}

export class PreventAllDamageByStaticHandler extends StaticHandler {
  static override readonly mode = "PreventAllDamageBy" as const;

  override build(ast: StaticAst, ctx: StaticHandlerCtx): StaticAbility {
    return buildPreventDamage(ast, ctx, { mode: "PreventAllDamageBy" });
  }
}

export class PreventAllDamageToStaticHandler extends StaticHandler {
  static override readonly mode = "PreventAllDamageTo" as const;

  override build(ast: StaticAst, ctx: StaticHandlerCtx): StaticAbility {
    return buildPreventDamage(ast, ctx, { mode: "PreventAllDamageTo" });
  }
}

staticHandlerRegistry.register(PreventAllDamageStaticHandler);
staticHandlerRegistry.register(PreventAllDamageByStaticHandler);
staticHandlerRegistry.register(PreventAllDamageToStaticHandler);
