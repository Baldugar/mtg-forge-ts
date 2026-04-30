// SPDX-License-Identifier: GPL-3.0-or-later
// Wave 74 — ColorlessDamageSource static handler. CR 105 — colors.
//
// Forge cards using this shape:
//   - Ghostly Flame  (Black and/or red permanents and spells are
//                      colorless sources of damage.)
//
// DSL (corpus):
//   S:Mode$ ColorlessDamageSource | ValidCard$ Permanent.Black+inZoneBattlefield,Permanent.Red+inZoneBattlefield,Spell.Black+inZoneStack,Spell.Red+inZoneStack | Description$ ...
//
// What it does (Forge): when the matched card deals damage, that damage
// is colorless regardless of the card's printed color. Used to bypass
// color-conditional prevention (e.g. CoP: Red, protection from black).
//
// Routing: ruleChanging per MODE_TO_CATEGORY. Pure characteristic-
// override consulted by the damage-color computation site.
//
// MVP scope: registration + gate helper (`damageColorOverride`). The
// damage-color tracking infra is not yet a first-class field on the
// DamageDealt event payload — the canonical event today carries
// `sourceId` only and downstream consumers re-derive color from the
// source card's layered colors. Two follow-ups are tracked as
// TODO(advanced):
//
//   1. Damage-event color slot                — the DamageDealt event
//      payload would gain a `damageColor: "white" | ... | "colorless"`
//      field (or `damageColors: ColorSet`), and the GameAction.damage
//      pipeline would consult `damageColorOverride` to populate it.
//      Once that lands, the existing read-side consumers (color-
//      conditional prevention replacements; protection-from-color
//      gates that pivot on damage source color rather than source
//      object color) can branch on the event field rather than on
//      the live source card's colors.
//
//   2. Source-color override at characteristic computation time —
//      Forge's exact behavior is a Layer 5 color-overwrite contributor:
//      while the static is in force AND the source matches, the source's
//      colors layer-output is the empty set ("colorless"). The current
//      LayerEngine doesn't have a first-class hook for "but only when
//      computing color for the purpose of damage assignment", so the
//      MVP exposes the helper for the future damage pipeline to read
//      directly.
//
// For the MVP, `damageColorOverride(game, sourceId)` returns
// `"colorless"` when any active ColorlessDamageSource gate matches the
// source card; downstream reads of source color for damage-coloration
// purposes consult this helper first. When the static is not in force
// (or the source doesn't match), the helper returns null and the
// canonical layer-engine color computation prevails.
import type { EntityId, ParamValue, StaticAbility, StaticAst } from "@mtg-forge-ts/core";
import type { Game } from "../../game.js";
import {
  StaticHandler,
  type StaticHandlerCtx,
  normalizeActiveInZones,
  staticHandlerRegistry,
} from "../static-handler.js";
import { buildCardIdPredicate, literalRaw } from "./restriction-helpers.js";

export interface ColorlessDamageSourcePayload {
  readonly kind: "colorlessDamageSource";
  /**
   * True iff `cardId` is a source whose damage should be treated as
   * colorless (overriding the card's printed/layered colors). Forge's
   * Ghostly Flame uses Permanent.Black+inZoneBattlefield etc., which
   * routes through cardMatchesFilter — Permanent / Spell base types
   * + inZoneBattlefield / inZoneStack qualifiers + Black/Red color
   * predicates.
   */
  readonly cardMatches: (cardId: EntityId, game: Game) => boolean;
}

export class ColorlessDamageSourceStaticHandler extends StaticHandler {
  static override readonly mode = "ColorlessDamageSource" as const;

  override build(ast: StaticAst, ctx: StaticHandlerCtx): StaticAbility {
    const params: Readonly<Record<string, ParamValue>> = ast.params;
    const validCardRaw = literalRaw(params.ValidCard) ?? "Card";
    const cardPred = buildCardIdPredicate(validCardRaw, ctx.sourceCardId, ctx.controllerSeat);

    const payload: ColorlessDamageSourcePayload = {
      kind: "colorlessDamageSource",
      cardMatches: (cardId, game) => cardPred(cardId, game),
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
      mode: "ColorlessDamageSource",
      describe: () => payload,
    };
  }
}

staticHandlerRegistry.register(ColorlessDamageSourceStaticHandler);
