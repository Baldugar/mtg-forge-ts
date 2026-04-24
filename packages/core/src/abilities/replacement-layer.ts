// SPDX-License-Identifier: GPL-3.0-or-later
// CR 616.1 — replacement-effect ordering layers. When multiple replacements
// apply to the same event, the replacement-orderer partitions them into
// layer buckets and applies within-layer tiebreak (affected-player /
// controller / AP) inside each bucket. Canonical order: cantHappen →
// control → copy → transform → other.

export const REPLACEMENT_LAYERS = ["cantHappen", "control", "copy", "transform", "other"] as const;

export type ReplacementLayer = (typeof REPLACEMENT_LAYERS)[number];

const ORDER: Record<ReplacementLayer, number> = {
  cantHappen: 0,
  control: 1,
  copy: 2,
  transform: 3,
  other: 4,
};

export const replacementLayerOrder = (layer: ReplacementLayer): number => ORDER[layer];
