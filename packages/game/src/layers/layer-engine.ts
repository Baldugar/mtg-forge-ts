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
import {
  type Characteristics,
  type EntityId,
  GameStateIntegrityError,
  LAYER_ORDER,
} from "@mtg-forge-ts/core";
import type { Game } from "../game.js";
import { deriveBaseCharacteristics } from "./base-characteristics.js";
import { applyLayer1Copy } from "./layer1-copy.js";

export interface LayerCacheEntry {
  readonly chars: Characteristics;
  readonly epoch: number;
}

export class LayerEngine {
  private epoch = 0;
  private readonly cache = new Map<EntityId, LayerCacheEntry>();

  constructor(private readonly game: Game) {}

  get currentEpoch(): number {
    return this.epoch;
  }

  bumpEpoch(_reason: string): void {
    this.epoch++;
    this.cache.clear();
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
    for (const _layer of LAYER_ORDER) {
      // Tasks 4-9 populate per-layer apply calls here.
    }
    this.cache.set(id, { chars, epoch: this.epoch });
    return chars;
  }
}
