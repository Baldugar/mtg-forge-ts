// SPDX-License-Identifier: GPL-3.0-or-later
// xoshiro256** (Blackman & Vigna, 2018) with SplitMix64 seeding.
// Reference: https://prng.di.unimi.it/xoshiro256starstar.c
//
// Why xoshiro256** and not java.util.Random (what Forge uses)?
// - Forge parity is not required by the master spec (deterministic TS output
//   is).  java.util.Random is a 48-bit LCG with poor spectral properties and
//   a tiny state; xoshiro256** has 2^256-1 period, good BigCrush results,
//   and is straightforward to implement with JS bigint.

import type { Rng, RngState } from "./rng.js";

const MASK64 = (1n << 64n) - 1n;

// Why pre-compute: TypeScript/V8 can hoist these, but expressing them as
// named constants makes the xoshiro/SplitMix64 paper lineage obvious at
// a glance.
const SPLITMIX_GAMMA = 0x9e3779b97f4a7c15n;
const SPLITMIX_MIX_1 = 0xbf58476d1ce4e5b9n;
const SPLITMIX_MIX_2 = 0x94d049bb133111ebn;

const rotl = (x: bigint, k: bigint): bigint => ((x << k) | (x >> (64n - k))) & MASK64;

export class SeededRng implements Rng {
  // Mutable 4-tuple holding the xoshiro256** state words.
  private s: [bigint, bigint, bigint, bigint];

  constructor(seed: bigint) {
    // Seed can be any bigint (including negative); mask to 64 bits so the
    // caller can pass signed bigints without surprising behavior.
    let z = seed & MASK64;
    const splitMix64Next = (): bigint => {
      z = (z + SPLITMIX_GAMMA) & MASK64;
      let y = ((z ^ (z >> 30n)) * SPLITMIX_MIX_1) & MASK64;
      y = ((y ^ (y >> 27n)) * SPLITMIX_MIX_2) & MASK64;
      return (y ^ (y >> 31n)) & MASK64;
    };
    this.s = [splitMix64Next(), splitMix64Next(), splitMix64Next(), splitMix64Next()];

    // xoshiro256** has an all-zero fixed point: if every state word is 0 it
    // produces 0 forever.  SplitMix64 cannot produce four zeros from any
    // seed in practice (the first output for z=0 is SPLITMIX_GAMMA's
    // avalanche, not 0), but guard anyway so that future seeding changes
    // can't silently break determinism.
    if (this.s[0] === 0n && this.s[1] === 0n && this.s[2] === 0n && this.s[3] === 0n) {
      this.s = [1n, 0n, 0n, 0n];
    }
  }

  nextLong(): bigint {
    const [s0, s1, s2, s3] = this.s;
    const result = (rotl((s1 * 5n) & MASK64, 7n) * 9n) & MASK64;
    const t = (s1 << 17n) & MASK64;
    // The xoshiro256** state-advance is a linear transformation over GF(2);
    // the order of assignments matters — keep it identical to the reference.
    this.s[2] = s2 ^ s0;
    this.s[3] = s3 ^ s1;
    this.s[1] = s1 ^ this.s[2];
    this.s[0] = s0 ^ this.s[3];
    this.s[2] = this.s[2] ^ t;
    this.s[3] = rotl(this.s[3], 45n);
    return result;
  }

  nextFloat(): number {
    // Take the top 53 bits: that's exactly the mantissa width of IEEE-754
    // doubles, so every representable double in [0, 1) appears with the
    // canonical uniform distribution.
    const bits = Number(this.nextLong() >> 11n);
    return bits / 2 ** 53;
  }

  nextInt(minInclusive: number, maxExclusive: number): number {
    if (!Number.isInteger(minInclusive) || !Number.isInteger(maxExclusive)) {
      throw new RangeError(`nextInt bounds must be integers, got [${minInclusive}, ${maxExclusive})`);
    }
    if (maxExclusive <= minInclusive) {
      throw new RangeError(
        `nextInt requires maxExclusive > minInclusive, got [${minInclusive}, ${maxExclusive})`,
      );
    }
    const range = maxExclusive - minInclusive;
    return minInclusive + Math.floor(this.nextFloat() * range);
  }

  choose<T>(arr: readonly T[]): T {
    if (arr.length === 0) {
      throw new RangeError("SeededRng.choose: empty array");
    }
    const idx = this.nextInt(0, arr.length);
    return arr[idx] as T;
  }

  shuffle<T>(arr: readonly T[]): T[] {
    const out = [...arr];
    // Fisher-Yates (Durstenfeld variant): iterate from the end, swap each
    // element with a uniformly-chosen element from the unvisited prefix.
    for (let i = out.length - 1; i > 0; i--) {
      const j = this.nextInt(0, i + 1);
      [out[i], out[j]] = [out[j] as T, out[i] as T];
    }
    return out;
  }

  getState(): RngState {
    // Return a fresh object; callers must not be able to poke the internal
    // state array by holding a reference to our return value.
    return { s0: this.s[0], s1: this.s[1], s2: this.s[2], s3: this.s[3] };
  }

  setState(st: RngState): void {
    // Copy the four words into a new internal tuple; if the caller retains
    // `st` and mutates fields (e.g. via `as any`), we must not see that.
    this.s = [st.s0, st.s1, st.s2, st.s3];
  }
}
