// SPDX-License-Identifier: GPL-3.0-or-later
// CR 613 layer engine. Computes Characteristics for any live Card by
// deriving the base state and walking LAYER_ORDER.
//
// Epoch-based cache (invalidation contract per spec §1): card zone change,
// counter change, static register/unregister, continuous effect start/end,
// attachment change, control change, face-down flip, timestamp reassignment
// → bumpEpoch(reason). Reads return cached if cached.epoch === currentEpoch.
//
// Subsystem-internal mutator: LayerEngine owns its cache + epoch. No outside
// code mutates them directly; callers that change board state call bumpEpoch
// with a reason tag (used for determinism tests + debug logs).
//
// The layer walk body is a skeleton here; Tasks 3-9 fill it in by reading
// per-layer effect arrays and applying them in order.
import { type Characteristics, type EntityId, GameStateIntegrityError } from "@mtg-forge-ts/core";
import type { Game } from "../game.js";
import { deriveBaseCharacteristics } from "./base-characteristics.js";
import { applyLayer1Copy } from "./layer1-copy.js";
import { applyFaceDownOverride } from "./layer1-face-down.js";
import { applyLayer2Control } from "./layer2-control.js";
import { type TextSubstitution, applyLayer3Text } from "./layer3-text.js";
import { type TypeChangeEffect, applyLayer4Type } from "./layer4-type.js";
import { type ColorChangeEffect, applyLayer5Color } from "./layer5-color.js";
import { type AbilityChangeEffect, applyLayer6Ability } from "./layer6-ability.js";
import {
  type Layer7aEffect,
  type Layer7bEffect,
  type Layer7cEffect,
  type Layer7dEffect,
  type Layer7eEffect,
  applyLayer7a,
  applyLayer7b,
  applyLayer7c,
  applyLayer7d,
  applyLayer7e,
} from "./layer7-pt.js";

export interface LayerCacheEntry {
  readonly chars: Characteristics;
  readonly epoch: number;
}

export class LayerEngine {
  private epoch = 0;
  private readonly cache = new Map<EntityId, LayerCacheEntry>();
  // Re-entrancy guard for bumpEpoch. SP2 Milestone H Task 34 wires
  // ContinuousEffectRegistry.checkEpoch() into bumpEpoch so asLongAs
  // effects re-evaluate after any layer-engine state change. checkEpoch
  // may call unregister(), which calls bumpEpoch() again — without this
  // flag the two would alternate forever on a single mutation. The nested
  // bump still invalidates the cache (counter ++ + clear), but skips the
  // asLongAs re-check since the outer bump will re-enter it once control
  // returns to the top-level call.
  private bumping = false;
  readonly textSubstitutions: TextSubstitution[] = [];
  readonly typeEffects: TypeChangeEffect[] = [];
  readonly colorEffects: ColorChangeEffect[] = [];
  readonly abilityEffects: AbilityChangeEffect[] = [];
  readonly pt7a: Layer7aEffect[] = [];
  readonly pt7b: Layer7bEffect[] = [];
  readonly pt7c: Layer7cEffect[] = [];
  readonly pt7d: Layer7dEffect[] = [];
  readonly pt7e: Layer7eEffect[] = [];

  constructor(private readonly game: Game) {}

  get currentEpoch(): number {
    return this.epoch;
  }

  bumpEpoch(_reason: string): void {
    this.epoch++;
    this.cache.clear();
    // SP2 Milestone H Task 34 — asLongAs continuous effects re-check
    // their condition after any state change that could invalidate it.
    // Routed through ContinuousEffectRegistry.checkEpoch so the registry
    // (not the layer engine) owns the iteration + drain-buffer plumbing.
    //
    // Guarded for re-entrancy: checkEpoch → unregister → bumpEpoch would
    // otherwise loop. The nested call still clears the cache (so consumers
    // reading during the outer bump see fresh characteristics), but we
    // skip the re-check until control returns to the outer frame.
    if (this.bumping) return;
    // Defensive: continuousEffectRegistry is constructed AFTER layerEngine
    // in Game's ctor. If anything bumps the epoch mid-construction before
    // the registry exists (no known caller does today, but future wiring
    // might), skip the re-check rather than crash — subsequent bumps will
    // pick up asLongAs effects as soon as the registry is live.
    if (!this.game.continuousEffectRegistry) return;
    this.bumping = true;
    try {
      this.game.continuousEffectRegistry.checkEpoch();
    } finally {
      this.bumping = false;
    }
  }

  getCached(id: EntityId): LayerCacheEntry | undefined {
    return this.cache.get(id);
  }

  computeCharacteristics(id: EntityId): Characteristics {
    const cached = this.cache.get(id);
    if (cached && cached.epoch === this.epoch) return cached.chars;
    const card = this.game.cards.get(id);
    if (!card) throw new GameStateIntegrityError(`LayerEngine: card ${id} not found`);
    const chars = deriveBaseCharacteristics(card);
    applyLayer1Copy(chars, card.copiedFrom);
    // CR 707.11 — face-down override applies AFTER copy effects: copying a
    // face-down card produces a face-down copy, but the face-down override
    // wins over the copiable values regardless of what was copied.
    applyFaceDownOverride(chars, card.faceDown);
    applyLayer2Control();
    applyLayer3Text(chars, this.textSubstitutions);
    applyLayer4Type(chars, this.typeEffects);
    applyLayer5Color(chars, this.colorEffects);
    applyLayer6Ability(chars, id, this.abilityEffects);
    applyLayer7a(chars, this.pt7a);
    applyLayer7b(chars, this.pt7b);
    applyLayer7c(chars, this.pt7c, id);
    applyLayer7d(chars, this.pt7d);
    applyLayer7e(chars, this.pt7e);
    this.cache.set(id, { chars, epoch: this.epoch });
    return chars;
  }
}
