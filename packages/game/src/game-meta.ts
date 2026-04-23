// SPDX-License-Identifier: GPL-3.0-or-later
// Immutable per-Game metadata: engine + card-data provenance and the bigint
// Rng seed (serialized as a lowercase hex string so GameMeta round-trips
// through JSON without bigint pitfalls).
export interface GameMeta {
  readonly engineVersion: string;
  readonly forgeSha: string;
  readonly cardDataSyncedAt: string;
  readonly crVersion: string;
  readonly seed: string;
}
