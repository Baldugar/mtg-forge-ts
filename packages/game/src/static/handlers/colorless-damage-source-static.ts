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
// Scope: registration + gate helper (`damageColorOverride`).
// `damageColorOverride(game, sourceId)` returns `"colorless"` when any
// active ColorlessDamageSource gate matches the source card; downstream
// reads of source color for damage-coloration purposes consult this
// helper first. When the static is not in force (or the source doesn't
// match), the helper returns null and the canonical layer-engine color
// computation prevails.
//
// Wave 108 — retired the two stale TODO(advanced) tails. (1) The
// "DamageDealt event color slot" tail — the corpus sweep against
// Forge's res/cardsfolder confirmed no card consumes a damage-event
// color field; every corpus consumer of damage-source-color (CoP:Red,
// protection-from-color targeting checks) reads the source's live
// color via the layer engine, then composes with damageColorOverride
// at the consumer site. The helper is the durable contract. (2) The
// "Layer 5 color-overwrite contributor" tail — Forge's
// StaticAbilityColorlessDamageSource is implemented as a per-query
// override on the damage path, not as a layer-engine contributor; our
// helper-driven shape is structurally identical and faithful.
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
