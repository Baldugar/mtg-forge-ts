// SPDX-License-Identifier: GPL-3.0-or-later
// The engine must be deterministic: given identical inputs (including the Rng
// seed) two runs must produce identical output. Every game constructs its own
// Rng and passes it explicitly through GameContext — no ambient Math.random,
// no Date.now-derived seeds, no crypto.randomUUID. RngState is exposed so
// GameSnapshot can pin the stream across undo/replay/sim-branch boundaries.
//
// Forge itself uses java.util.Random (an LCG); we deliberately choose
// xoshiro256** instead because (a) LCG streams are trivially reversible and
// have poor spectral properties, (b) bit-exact Forge parity is not required
// by the master spec — only deterministic TS output. See seeded-rng.ts.

export interface RngState {
  readonly s0: bigint;
  readonly s1: bigint;
  readonly s2: bigint;
  readonly s3: bigint;
}

export interface Rng {
  /** Uniform integer in `[minInclusive, maxExclusive)`. Throws if bounds are not integers or if max <= min. */
  nextInt(minInclusive: number, maxExclusive: number): number;
  /** Uniform double in `[0, 1)` using the top 53 bits of a 64-bit word. */
  nextFloat(): number;
  /** Uniform unsigned 64-bit integer in `[0, 2^64)`. */
  nextLong(): bigint;
  /** Pick one element; throws RangeError on empty input. */
  choose<T>(arr: readonly T[]): T;
  /** Fisher-Yates shuffle; returns a fresh array (input not mutated). */
  shuffle<T>(arr: readonly T[]): T[];
  /** Snapshot the internal state. The returned object is a fresh copy. */
  getState(): RngState;
  /** Restore internal state from a snapshot. The snapshot is copied, not aliased. */
  setState(s: RngState): void;
}

/**
 * Serialized form of RngState. bigint is not JSON-native (JSON.stringify
 * throws on bigint), so GameSnapshot must persist RngState via this shape.
 * Hex strings are lowercase and have no "0x" prefix — stable and compact.
 */
export interface SerializedRngState {
  readonly s0: string;
  readonly s1: string;
  readonly s2: string;
  readonly s3: string;
}

export function serializeRngState(s: RngState): SerializedRngState {
  return {
    s0: s.s0.toString(16),
    s1: s.s1.toString(16),
    s2: s.s2.toString(16),
    s3: s.s3.toString(16),
  };
}

export function deserializeRngState(s: SerializedRngState): RngState {
  // BigInt("0x") throws — guard against empty hex inputs explicitly so the
  // error is meaningful rather than the opaque SyntaxError from BigInt.
  if (s.s0 === "" || s.s1 === "" || s.s2 === "" || s.s3 === "") {
    throw new SyntaxError("deserializeRngState: empty hex string");
  }
  return {
    s0: BigInt(`0x${s.s0}`),
    s1: BigInt(`0x${s.s1}`),
    s2: BigInt(`0x${s.s2}`),
    s3: BigInt(`0x${s.s3}`),
  };
}
