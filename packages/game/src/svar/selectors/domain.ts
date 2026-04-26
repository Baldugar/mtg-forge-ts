// SPDX-License-Identifier: GPL-3.0-or-later
// Count$Domain — count distinct basic land types (Plains/Island/Swamp/
// Mountain/Forest) among lands the controller controls. Five-color "Domain"
// mechanic from MTG (CR 712 Battle of Wits-era Forge mapping).
//
// Forge reference: AbilityUtils.calculateAmount handling for "Domain" string.
// Used by cards with `Amount$ X` and `SVar:X:Count$Domain` (Yavimaya
// Sojourner, Tribal Flames, Allied Strategies, Cromat, Coalition's Pledge,
// etc.).
//
// Implementation:
//   - Walk game.cards; pick cards on the battlefield controlled by the
//     evaluation context's controller, with CardType.Land in their layered
//     types (so animate-land-into-creature still counts).
//   - Collect each candidate's subtype set; union and intersect with the
//     basic-land subtype roster.
//   - Result = size of the resulting set, capped at 5.
//
// Non-basic lands without basic land subtypes contribute 0; dual lands
// (Tundra: Land — Plains Island) contribute their explicit subtypes.
//
// The selector registers under TWO keys for parser-shape resilience:
//   - countArgRegistry["Domain"] — for `Count$Domain` (the canonical Forge
//     spelling; parsed as { kind:"Count", args:[{raw:"Domain"}] }).
//   - selectorRegistry["Domain"]  — for direct `Domain$` invocations.
import { CardType, ZoneType } from "@mtg-forge-ts/core";
import type { SVarExpressionAst } from "@mtg-forge-ts/core";
import type { SvarContext } from "../context.js";
import { selectorRegistry } from "../selector-registry.js";
import { countArgRegistry } from "./count.js";

const BASIC_LAND_SUBTYPES: ReadonlySet<string> = new Set(["Plains", "Island", "Swamp", "Mountain", "Forest"]);

const computeDomain = (_ast: SVarExpressionAst, ctx: SvarContext): number => {
  const controller = ctx.controller;
  if (controller === undefined) return 0;
  const distinctBasics = new Set<string>();

  for (const [id, card] of ctx.game.cards) {
    if (card.zone !== ZoneType.Battlefield) continue;
    if (card.controllerSeat !== controller) continue;
    const chars = ctx.game.layerEngine.computeCharacteristics(id);
    if (!chars.types.has(CardType.Land)) continue;
    for (const sub of chars.subtypes) {
      if (BASIC_LAND_SUBTYPES.has(sub)) {
        distinctBasics.add(sub);
        if (distinctBasics.size === BASIC_LAND_SUBTYPES.size) break;
      }
    }
    if (distinctBasics.size === BASIC_LAND_SUBTYPES.size) break;
  }
  return distinctBasics.size;
};

selectorRegistry.register("Domain", computeDomain);
countArgRegistry.register("Domain", computeDomain);
