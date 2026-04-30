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
// TODO(advanced):
//   - ValidTarget$ sub-filter (Mark-of-Asylum-style "damage to X from
//     non-X can't be prevented" — opposite-direction shape).
//   - Combat$ True/False sub-filter for combat-only / non-combat-only
//     prevention-prevention.
import type { EntityId, ParamValue, ReplacementAbility, StaticAbility, StaticAst } from "@mtg-forge-ts/core";
import type { Game } from "../../game.js";
import type { ReplacementGenPayload } from "../../statics/replacement-generating.js";
import {
  StaticHandler,
  type StaticHandlerCtx,
  normalizeActiveInZones,
  staticHandlerRegistry,
} from "../static-handler.js";
import { buildCardIdPredicate, literalRaw } from "./restriction-helpers.js";

export interface CantPreventDamagePayload extends ReplacementGenPayload {
  readonly sourceMatches: (cardId: EntityId, game: Game) => boolean;
}

export class CantPreventDamageStaticHandler extends StaticHandler {
  static override readonly mode = "CantPreventDamage" as const;

  override build(ast: StaticAst, ctx: StaticHandlerCtx): StaticAbility {
    const params: Readonly<Record<string, ParamValue>> = ast.params;
    const validSourceRaw = literalRaw(params.ValidSource) ?? "Card";
    const sourcePred = buildCardIdPredicate(validSourceRaw, ctx.sourceCardId, ctx.controllerSeat);

    const payload: CantPreventDamagePayload = {
      kind: "replacementGen",
      replacements: [] as readonly ReplacementAbility[],
      sourceMatches: (cardId, game) => sourcePred(cardId, game),
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
