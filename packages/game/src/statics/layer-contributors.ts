// SPDX-License-Identifier: GPL-3.0-or-later
// Route continuous-category StaticAbility contributions into the
// appropriate LayerEngine arrays. Called by StaticEffectRegistry on
// register/unregister (Task 26).
//
// The payload returned by StaticAbility.describe() for category
// "continuous" is a discriminated union of layer-effect shapes (the
// layer appliers already have type definitions for each; we re-export
// them here as a union for convenience).
//
// Stability contract: describe() MUST return the same object reference
// across register + unregister calls for the same static instance.
// removeFromLayers() removes by referential equality — if describe()
// returned a fresh object each call, removal would be a silent no-op
// and effects would leak into the layer array.
//
// The "abilityGranting" category is routed through the same "ability"
// payload kind (Layer 6) since there is no semantic distinction at the
// contribution level; Task 28 adds dedicated tests for ability-granting
// end-to-end.
import type { StaticAbility } from "@mtg-forge-ts/core";
import type { Game } from "../game.js";
import type { TextSubstitution } from "../layers/layer3-text.js";
import type { TypeChangeEffect } from "../layers/layer4-type.js";
import type { ColorChangeEffect } from "../layers/layer5-color.js";
import type { AbilityChangeEffect } from "../layers/layer6-ability.js";
import type { Layer7bEffect, Layer7cEffect, Layer7dEffect } from "../layers/layer7-pt.js";

export type ContinuousPayload =
  | { readonly kind: "text"; readonly effect: TextSubstitution }
  | { readonly kind: "type"; readonly effect: TypeChangeEffect }
  | { readonly kind: "color"; readonly effect: ColorChangeEffect }
  | { readonly kind: "ability"; readonly effect: AbilityChangeEffect }
  | { readonly kind: "pt-set"; readonly effect: Layer7bEffect }
  | { readonly kind: "pt-modify"; readonly effect: Layer7cEffect }
  | { readonly kind: "pt-counter"; readonly effect: Layer7dEffect };

// WHY the two gates: only "continuous" and "abilityGranting" statics
// contribute to the LayerEngine; other categories (costModification,
// cantMustMay, replacementGenerating, preventDamage, ruleChanging,
// alternativeCost) use their own paths.
const isLayerContributor = (s: StaticAbility): boolean =>
  s.category === "continuous" || s.category === "abilityGranting";

export const contributeToLayers = (game: Game, s: StaticAbility): void => {
  if (!isLayerContributor(s)) return;
  const payload = s.describe() as ContinuousPayload;
  switch (payload.kind) {
    case "text":
      game.layerEngine.textSubstitutions.push(payload.effect);
      break;
    case "type":
      game.layerEngine.typeEffects.push(payload.effect);
      break;
    case "color":
      game.layerEngine.colorEffects.push(payload.effect);
      break;
    case "ability":
      game.layerEngine.abilityEffects.push(payload.effect);
      break;
    case "pt-set":
      game.layerEngine.pt7b.push(payload.effect);
      break;
    case "pt-modify":
      game.layerEngine.pt7c.push(payload.effect);
      break;
    case "pt-counter":
      game.layerEngine.pt7d.push(payload.effect);
      break;
    default: {
      const _: never = payload;
      throw new Error(`contributeToLayers: unreachable ${JSON.stringify(_)}`);
    }
  }
  game.layerEngine.bumpEpoch("static-continuous-register");
};

// Removal uses in-place splice rather than reassignment so the LayerEngine
// arrays keep their `readonly` class-field discipline (the reference is
// immutable; the contents are not). If describe() returns a fresh object
// on the second call, indexOf will miss and the effect will leak — see
// the stability contract in the module header.
const spliceOut = <T>(arr: T[], target: T): void => {
  const i = arr.indexOf(target);
  if (i >= 0) arr.splice(i, 1);
};

export const removeFromLayers = (game: Game, s: StaticAbility): void => {
  if (!isLayerContributor(s)) return;
  const payload = s.describe() as ContinuousPayload;
  switch (payload.kind) {
    case "text":
      spliceOut(game.layerEngine.textSubstitutions, payload.effect);
      break;
    case "type":
      spliceOut(game.layerEngine.typeEffects, payload.effect);
      break;
    case "color":
      spliceOut(game.layerEngine.colorEffects, payload.effect);
      break;
    case "ability":
      spliceOut(game.layerEngine.abilityEffects, payload.effect);
      break;
    case "pt-set":
      spliceOut(game.layerEngine.pt7b, payload.effect);
      break;
    case "pt-modify":
      spliceOut(game.layerEngine.pt7c, payload.effect);
      break;
    case "pt-counter":
      spliceOut(game.layerEngine.pt7d, payload.effect);
      break;
    default: {
      const _: never = payload;
      throw new Error(`removeFromLayers: unreachable ${JSON.stringify(_)}`);
    }
  }
  game.layerEngine.bumpEpoch("static-continuous-unregister");
};
