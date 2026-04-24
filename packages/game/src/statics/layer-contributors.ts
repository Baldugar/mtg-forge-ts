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
//
// SP2 Milestone H (Task 33) extracted the payload-kind dispatch into
// layer-dispatch.ts so ContinuousEffectRegistry can share the same
// push/splice logic. `ContinuousPayload` is preserved as an alias to
// `LayerPayload` for existing re-exports.
import type { StaticAbility } from "@mtg-forge-ts/core";
import type { Game } from "../game.js";
import { type LayerPayload, pushLayerPayload, removeLayerPayload } from "../layers/layer-dispatch.js";

export type ContinuousPayload = LayerPayload;

// WHY the two gates: only "continuous" and "abilityGranting" statics
// contribute to the LayerEngine; other categories (costModification,
// cantMustMay, replacementGenerating, preventDamage, ruleChanging,
// alternativeCost) use their own paths.
const isLayerContributor = (s: StaticAbility): boolean =>
  s.category === "continuous" || s.category === "abilityGranting";

export const contributeToLayers = (game: Game, s: StaticAbility): void => {
  if (!isLayerContributor(s)) return;
  const payload = s.describe() as ContinuousPayload;
  pushLayerPayload(game, payload);
  game.layerEngine.bumpEpoch("static-continuous-register");
};

export const removeFromLayers = (game: Game, s: StaticAbility): void => {
  if (!isLayerContributor(s)) return;
  const payload = s.describe() as ContinuousPayload;
  removeLayerPayload(game, payload);
  game.layerEngine.bumpEpoch("static-continuous-unregister");
};
