// SPDX-License-Identifier: GPL-3.0-or-later
// Wave 70.E — CantPreventDamage static handler. CR 615 — damage-prevention
// prevention. Forge cards using this:
//   - Comet, Stellar Pup        (damage from this can't be prevented)
//   - Inferno                   (its damage can't be prevented)
//   - Some Eldrazi              (Annihilator-side: damage can't be prevented)
//   - Mark of Asylum            (NB: opposite shape — prevents damage TO
//                                 filtered creatures from filtered sources;
//                                 here we model the canonical "damage from
//                                 source can't be prevented" form)
//
// DSL:
//   S:Mode$ CantPreventDamage | ValidSource$ Card.Self    | Description$ ...
//   S:Mode$ CantPreventDamage | ValidSource$ Creature.Red | Description$ ...
//
// What it does (Forge): the matched source's damage can't be prevented.
// The Wave 60.E PreventAllDamage / PreventAllDamageBy / PreventAllDamageTo
// statics MUST consult `canDamageBePrevented(game, sourceId)` before
// matching; if any active CantPreventDamage matches the damage source,
// every prevention static is bypassed for that source — the damage
// flows through normally and DamageDealt fires.
//
// This is the precedence-rule realisation of CR 615.6 ("damage that can't
// be prevented is still damage that can't be prevented after replacement
// effects modify it"). Mirrors Forge's StaticAbilityCantPreventDamage
// path which short-circuits the prevention loop on a source match.
//
// Routing: replacementGenerating category — already mapped in
// MODE_TO_CATEGORY (alongside the rest of the Cant* damage / life family).
// The replacements list is empty; the gate is enforced at the prevention
// consultation site (wouldPreventDamage in wave60-damage-gates.ts).
//
// MVP scope:
//   - ValidSource$ <filter> — Wave 32 grammar via cardMatchesFilter.
//   - Card.Self short-circuit honored (sourceCardId === cardId).
// Wave 107 — closes the prior ValidTarget$ + Combat$ TODO(advanced) tail.
// The handler now compiles all three sub-filters at build time and
// exposes a single `matchesEvent(sourceId, targetKind, targetId,
// isCombat, game)` predicate; the legacy `sourceMatches(cardId, game)`
// shorthand is retained for the no-target-context call sites
// (AI evaluator pre-flight, combat-handler probes). The consumer in
// statics/wave60-damage-gates.ts forwards the full event context when
// available so Mark-of-Asylum-style "damage to X from non-X can't be
// prevented" and Combat$ True/False scoping become honored.
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

type DamageTargetKind = "creature" | "player" | "planeswalker" | "battle";

// Tri-valued Combat$ filter — undefined (no filter), true (combat-only),
// false (non-combat-only).
const parseCombatFilter = (raw: string | undefined): boolean | undefined => {
  if (raw === undefined) return undefined;
  if (raw === "True" || raw === "true") return true;
  if (raw === "False" || raw === "false") return false;
  return undefined;
};

export interface CantPreventDamagePayload extends ReplacementGenPayload {
  /** Legacy source-only probe (no target context). */
  readonly sourceMatches: (cardId: EntityId, game: Game) => boolean;
  /**
   * Full event match honoring ValidSource$ + ValidTarget$ + Combat$
   * sub-filters. The consumer (`canDamageBePrevented`) forwards the
   * damage event context so opposite-direction shapes (Mark-of-Asylum)
   * and combat-only / non-combat-only scoping match correctly.
   */
  readonly matchesEvent: (
    sourceId: EntityId,
    targetKind: DamageTargetKind,
    targetId: EntityId | PlayerSeat,
    isCombat: boolean,
    game: Game,
  ) => boolean;
}

export class CantPreventDamageStaticHandler extends StaticHandler {
  static override readonly mode = "CantPreventDamage" as const;

  override build(ast: StaticAst, ctx: StaticHandlerCtx): StaticAbility {
    const params: Readonly<Record<string, ParamValue>> = ast.params;
    const validSourceRaw = literalRaw(params.ValidSource) ?? "Card";
    const validTargetRaw = literalRaw(params.ValidTarget);
    const combatRaw = literalRaw(params.Combat);
    const combatFilter = parseCombatFilter(combatRaw);
    const sourcePred = buildCardIdPredicate(validSourceRaw, ctx.sourceCardId, ctx.controllerSeat);
    // Mixed card/player target predicate — same shape as PreventDamage's
    // CompiledTargetPred. Player damage hits the seat predicate; card-kind
    // damage hits the card predicate. Both default to always-true when
    // ValidTarget$ is omitted.
    const targetCardPred =
      validTargetRaw === undefined
        ? () => true
        : buildCardIdPredicate(validTargetRaw, ctx.sourceCardId, ctx.controllerSeat);
    const targetSeatPred =
      validTargetRaw === undefined ? () => true : buildPlayerPredicate(validTargetRaw, ctx.controllerSeat);

    const matchesEvent = (
      sourceId: EntityId,
      targetKind: DamageTargetKind,
      targetId: EntityId | PlayerSeat,
      isCombat: boolean,
      game: Game,
    ): boolean => {
      if (combatFilter !== undefined && combatFilter !== isCombat) return false;
      if (!sourcePred(sourceId, game)) return false;
      if (validTargetRaw !== undefined) {
        if (targetKind === "player") {
          if (typeof targetId !== "number") return false;
          if (!targetSeatPred(targetId as PlayerSeat)) return false;
        } else {
          if (typeof targetId !== "number") return false;
          if (!targetCardPred(targetId as EntityId, game)) return false;
        }
      }
      return true;
    };

    const payload: CantPreventDamagePayload = {
      kind: "replacementGen",
      replacements: [] as readonly ReplacementAbility[],
      sourceMatches: (cardId, game) => sourcePred(cardId, game),
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
      mode: "CantPreventDamage",
      describe: () => payload,
    };
  }
}

staticHandlerRegistry.register(CantPreventDamageStaticHandler);
