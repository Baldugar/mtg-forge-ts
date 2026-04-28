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
import type { GrantedAbilitySweep } from "../static/handlers/granted-ability.js";
import type { MayLookAtGate } from "../statics/wave60-may-look-at-gate.js";
import type { Layer6KeywordGrant, Layer6KeywordRemoval } from "./keyword-layer.js";
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
  | { readonly kind: "kw-grant"; readonly effect: Layer6KeywordGrant }
  // Wave 60.F — Layer 6 RemoveKeyword$ on Continuous. Negative keyword
  // removal applied after additive grants in `effectiveGrantedKeywords` and
  // also short-circuited in the `hasKeyword` combat helper. Symmetric
  // register/unregister with kw-grant; same predicate plumbing.
  | { readonly kind: "kw-remove"; readonly effect: Layer6KeywordRemoval }
  | { readonly kind: "pt-set"; readonly effect: Layer7bEffect }
  | { readonly kind: "pt-modify"; readonly effect: Layer7cEffect }
  | { readonly kind: "pt-counter"; readonly effect: Layer7dEffect }
  // Wave 32 — multi-payload envelope. A single Continuous static can
  // contribute several layer effects (e.g. Threshold = pt-modify +
  // kw-grant). The envelope is processed by walking `entries` in order;
  // referential equality on the inner payloads' effect references is
  // preserved so register/unregister round-trip correctly.
  | { readonly kind: "multi"; readonly entries: readonly LayerPayload[] }
  // SP3 Batch D — cleanup-only payload. EffectEffect (delayed-trigger host)
  // registers a continuous effect whose sole purpose is to drive a cleanup
  // hook at duration expiry (tearing down the host card + its synthesized
  // triggers/replacements/statics). The payload itself is inert: it does
  // not flow into any LayerEngine array. Adding it here keeps the
  // discriminated-union check exhaustive across pushLayerPayload /
  // removeLayerPayload without introducing a side channel.
  | { readonly kind: "noop" }
  // Wave 60.B — Continuous static grants of T/R/S abilities. The payload
  // owns a sweep that, on push, registers grants for all currently-
  // matched cards and registers itself with `layerEngine.grantedAbilitySweeps`
  // so subsequent epoch bumps reconcile filter-membership churn. On
  // remove, the sweep tears down all current grants and is dropped from
  // the sweep list. The payload is otherwise inert from a layer-array
  // perspective — granted T/R/S abilities flow through their own
  // registries, not the layer engine.
  | { readonly kind: "granted-ability"; readonly sweep: GrantedAbilitySweep }
  // Wave 60.F — MayLookAt$ peek-rights gate. Push/remove appends to /
  // splices from `layerEngine.mayLookAtGates`. The query helper
  // `mayLookAtFaceDown(game, cardId, seat)` reads this list to answer
  // face-down visibility probes.
  | { readonly kind: "may-look-at"; readonly gate: MayLookAtGate };

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
    case "kw-grant":
      game.layerEngine.keywordGrants.push(payload.effect);
      break;
    case "kw-remove":
      game.layerEngine.keywordRemovals.push(payload.effect);
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
    case "multi":
      for (const entry of payload.entries) pushLayerPayload(game, entry);
      break;
    case "noop":
      // No layer state to mutate — this payload exists only so the
      // continuous-effect-registry can host a cleanup hook against a
      // duration. See LayerPayload's "noop" doc-comment.
      break;
    case "granted-ability": {
      // Wave 60.B — register the sweep so subsequent bumpEpoch calls
      // reconcile filter-membership churn, then run an initial sweep so
      // grants land for currently-matched cards. The sweep object is
      // referentially identical across push/remove (same contract as
      // every other layer-payload effect ref), so the splice in
      // removeLayerPayload finds it.
      game.layerEngine.grantedAbilitySweeps.push(payload.sweep);
      payload.sweep.sweep(game);
      break;
    }
    case "may-look-at":
      // Wave 60.F — push the gate; queries via mayLookAtFaceDown walk the
      // list live so no further side-effects are needed at push time.
      game.layerEngine.mayLookAtGates.push(payload.gate);
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
    case "kw-grant":
      spliceOut(game.layerEngine.keywordGrants, payload.effect);
      break;
    case "kw-remove":
      spliceOut(game.layerEngine.keywordRemovals, payload.effect);
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
    case "multi":
      // Splice in reverse order so referential identity matches the push
      // ordering even if entries shift indices (defensive — current layer
      // arrays don't depend on order, but this keeps the shape consistent
      // with how the registry expects symmetric register/unregister).
      for (let i = payload.entries.length - 1; i >= 0; i--) {
        const entry = payload.entries[i];
        if (entry !== undefined) removeLayerPayload(game, entry);
      }
      break;
    case "noop":
      // Mirrors the noop branch in pushLayerPayload — nothing to splice.
      break;
    case "granted-ability": {
      // Wave 60.B — tear down all granted abilities currently held by
      // the sweep, then splice it out of the sweeps list so future
      // bumpEpoch calls don't visit a stale sweep.
      payload.sweep.removeAll(game);
      const i = game.layerEngine.grantedAbilitySweeps.indexOf(payload.sweep);
      if (i >= 0) game.layerEngine.grantedAbilitySweeps.splice(i, 1);
      break;
    }
    case "may-look-at": {
      // Wave 60.F — splice the gate out by reference. Same referential-
      // equality contract as the rest of the layer-payload effect refs.
      const i = game.layerEngine.mayLookAtGates.indexOf(payload.gate);
      if (i >= 0) game.layerEngine.mayLookAtGates.splice(i, 1);
      break;
    }
    default: {
      const _: never = payload;
      throw new Error(`removeLayerPayload: unreachable ${JSON.stringify(_)}`);
    }
  }
};
