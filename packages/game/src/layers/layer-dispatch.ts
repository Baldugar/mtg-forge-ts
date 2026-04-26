// SPDX-License-Identifier: GPL-3.0-or-later
// Shared payload-kind dispatch for LayerEngine array mutation. Both
// StaticEffectRegistry (via statics/layer-contributors.ts) and
// ContinuousEffectRegistry (continuous/continuous-effect-registry.ts)
// push/splice per-layer effect records based on a discriminated payload
// kind. Centralizing the dispatch here keeps both sides in lockstep when
// a new payload kind (e.g., "pt-switch" for Layer 7e) is added.
//
// Referential-equality contract: removePayload() uses array.indexOf on the
// `effect` reference. Callers MUST pass the same effect object on register
// and unregister — a fresh object literal on removal silently leaks the
// original into the layer array.
import type { Game } from "../game.js";
import type { TextSubstitution } from "./layer3-text.js";
import type { TypeChangeEffect } from "./layer4-type.js";
import type { ColorChangeEffect } from "./layer5-color.js";
import type { AbilityChangeEffect } from "./layer6-ability.js";
import type { Layer7bEffect, Layer7cEffect, Layer7dEffect } from "./layer7-pt.js";

export type LayerPayload =
  | { readonly kind: "text"; readonly effect: TextSubstitution }
  | { readonly kind: "type"; readonly effect: TypeChangeEffect }
  | { readonly kind: "color"; readonly effect: ColorChangeEffect }
  | { readonly kind: "ability"; readonly effect: AbilityChangeEffect }
  | { readonly kind: "pt-set"; readonly effect: Layer7bEffect }
  | { readonly kind: "pt-modify"; readonly effect: Layer7cEffect }
  | { readonly kind: "pt-counter"; readonly effect: Layer7dEffect }
  // SP3 Batch D — cleanup-only payload. EffectEffect (delayed-trigger host)
  // registers a continuous effect whose sole purpose is to drive a cleanup
  // hook at duration expiry (tearing down the host card + its synthesized
  // triggers/replacements/statics). The payload itself is inert: it does
  // not flow into any LayerEngine array. Adding it here keeps the
  // discriminated-union check exhaustive across pushLayerPayload /
  // removeLayerPayload without introducing a side channel.
  | { readonly kind: "noop" };

export const pushLayerPayload = (game: Game, payload: LayerPayload): void => {
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
    case "noop":
      // No layer state to mutate — this payload exists only so the
      // continuous-effect-registry can host a cleanup hook against a
      // duration. See LayerPayload's "noop" doc-comment.
      break;
    default: {
      const _: never = payload;
      throw new Error(`pushLayerPayload: unreachable ${JSON.stringify(_)}`);
    }
  }
};

const spliceOut = <T>(arr: T[], target: T): void => {
  const i = arr.indexOf(target);
  if (i >= 0) arr.splice(i, 1);
};

export const removeLayerPayload = (game: Game, payload: LayerPayload): void => {
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
    case "noop":
      // Mirrors the noop branch in pushLayerPayload — nothing to splice.
      break;
    default: {
      const _: never = payload;
      throw new Error(`removeLayerPayload: unreachable ${JSON.stringify(_)}`);
    }
  }
};
