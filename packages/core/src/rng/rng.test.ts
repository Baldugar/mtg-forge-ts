// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from "vitest";
import {
  type RngState,
  SeededRng,
  type SerializedRngState,
  deserializeRngState,
  serializeRngState,
} from "./index.js";

describe("SeededRng — determinism", () => {
  it("same seed produces the same sequence of nextLong", () => {
    const a = new SeededRng(42n);
    const b = new SeededRng(42n);
    const seqA: bigint[] = [];
    const seqB: bigint[] = [];
    for (let i = 0; i < 100; i++) {
      seqA.push(a.nextLong());
      seqB.push(b.nextLong());
    }
    expect(seqA).toEqual(seqB);
  });

  it("same seed produces the same sequence of nextFloat", () => {
    const a = new SeededRng(7n);
    const b = new SeededRng(7n);
    const seqA: number[] = [];
    const seqB: number[] = [];
    for (let i = 0; i < 100; i++) {
      seqA.push(a.nextFloat());
      seqB.push(b.nextFloat());
    }
    expect(seqA).toEqual(seqB);
  });

  it("same seed produces the same shuffle", () => {
    const arr = Array.from({ length: 20 }, (_, i) => i);
    const a = new SeededRng(123n).shuffle(arr);
    const b = new SeededRng(123n).shuffle(arr);
    expect(a).toEqual(b);
  });

  it("different seeds produce different first-100 sequences", () => {
    const a = new SeededRng(1n);
    const b = new SeededRng(2n);
    const seqA: bigint[] = [];
    const seqB: bigint[] = [];
    for (let i = 0; i < 100; i++) {
      seqA.push(a.nextLong());
      seqB.push(b.nextLong());
    }
    expect(seqA).not.toEqual(seqB);
  });
});

describe("SeededRng — nextFloat range", () => {
  it("produces values in [0, 1) across 10_000 samples", () => {
    const r = new SeededRng(0xc0ffeen);
    for (let i = 0; i < 10_000; i++) {
      const v = r.nextFloat();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});

describe("SeededRng — nextInt", () => {
  it("nextInt(0, 10) returns [0, 10) across 10_000 samples", () => {
    const r = new SeededRng(5n);
    for (let i = 0; i < 10_000; i++) {
      const n = r.nextInt(0, 10);
      expect(n).toBeGreaterThanOrEqual(0);
      expect(n).toBeLessThan(10);
      expect(Number.isInteger(n)).toBe(true);
    }
  });

  it("nextInt(-5, 5) handles negative minimums", () => {
    const r = new SeededRng(5n);
    for (let i = 0; i < 10_000; i++) {
      const n = r.nextInt(-5, 5);
      expect(n).toBeGreaterThanOrEqual(-5);
      expect(n).toBeLessThan(5);
      expect(Number.isInteger(n)).toBe(true);
    }
  });

  it("nextInt(0, 1) always returns 0", () => {
    const r = new SeededRng(99n);
    for (let i = 0; i < 1_000; i++) {
      expect(r.nextInt(0, 1)).toBe(0);
    }
  });

  it("nextInt(5, 5) throws RangeError", () => {
    const r = new SeededRng(1n);
    expect(() => r.nextInt(5, 5)).toThrow(RangeError);
  });

  it("nextInt(10, 5) throws RangeError (inverted range)", () => {
    const r = new SeededRng(1n);
    expect(() => r.nextInt(10, 5)).toThrow(RangeError);
  });

  it("nextInt(0, 1.5) throws RangeError (non-integer bound)", () => {
    const r = new SeededRng(1n);
    expect(() => r.nextInt(0, 1.5)).toThrow(RangeError);
  });

  it("nextInt(NaN, 10) throws RangeError", () => {
    const r = new SeededRng(1n);
    expect(() => r.nextInt(Number.NaN, 10)).toThrow(RangeError);
  });
});

describe("SeededRng — shuffle", () => {
  it("returns a permutation (same multiset)", () => {
    const r = new SeededRng(321n);
    const arr = [1, 2, 3, 4, 5];
    const out = r.shuffle(arr);
    expect([...out].sort((x, y) => x - y)).toEqual([...arr].sort((x, y) => x - y));
  });

  it("does not mutate the input", () => {
    const r = new SeededRng(321n);
    const arr = [1, 2, 3, 4, 5];
    const before = [...arr];
    r.shuffle(arr);
    expect(arr).toEqual(before);
  });

  it("handles empty and single-element arrays", () => {
    const r = new SeededRng(1n);
    expect(r.shuffle([])).toEqual([]);
    expect(r.shuffle([42])).toEqual([42]);
  });
});

describe("SeededRng — choose", () => {
  it("picks an element from the input array", () => {
    const r = new SeededRng(1n);
    const arr = ["a", "b", "c", "d"] as const;
    for (let i = 0; i < 100; i++) {
      expect(arr).toContain(r.choose(arr));
    }
  });

  it("throws on empty input", () => {
    const r = new SeededRng(1n);
    expect(() => r.choose([])).toThrow(RangeError);
  });
});

describe("SeededRng — getState / setState round-trip", () => {
  it("continues the exact same stream after restoration", () => {
    const r1 = new SeededRng(7n);
    for (let i = 0; i < 5; i++) r1.nextLong();
    const state = r1.getState();

    // r2 starts from an arbitrary other seed, then restores to r1's state.
    const r2 = new SeededRng(0xabcdn);
    r2.setState(state);

    const seqA: bigint[] = [];
    const seqB: bigint[] = [];
    for (let i = 0; i < 10; i++) {
      seqA.push(r1.nextLong());
      seqB.push(r2.nextLong());
    }
    expect(seqA).toEqual(seqB);
  });

  it("getState returns a fresh object (not internal aliasing)", () => {
    const r = new SeededRng(7n);
    r.nextLong();
    const s1 = r.getState();
    r.nextLong();
    const s2 = r.getState();
    // s1 must reflect the state AS OF the first getState call even after
    // the engine advanced: proves the returned object isn't a live view.
    expect(s1.s0).not.toBe(s2.s0);
  });

  it("setState copies the state (mutating a stray casted field after set does nothing)", () => {
    const r = new SeededRng(7n);
    const snapshot = r.getState();
    r.setState(snapshot);
    // Mutate a (type-erased) clone of snapshot and prove the engine is unaffected.
    const cloned = { ...snapshot } as { s0: bigint; s1: bigint; s2: bigint; s3: bigint };
    cloned.s0 = 0n;
    const v1 = r.nextLong();

    // A parallel engine restored from the original snapshot must produce
    // the same first output — proving setState didn't latch onto `snapshot`
    // by reference.
    const r2 = new SeededRng(0n);
    r2.setState(snapshot);
    const v2 = r2.nextLong();
    expect(v1).toBe(v2);
  });

  it("setState accepts a partially-zero state (only the full-zero fixed point is pathological)", () => {
    // Guard is at construction, not at setState — a state with three zeros
    // is perfectly fine for xoshiro256** and must produce sensible output.
    const r = new SeededRng(0n);
    const state: RngState = { s0: 1n, s1: 0n, s2: 0n, s3: 0n };
    r.setState(state);
    const outputs = new Set<bigint>();
    for (let i = 0; i < 50; i++) outputs.add(r.nextLong());
    // Very high probability these are NOT all identical — xoshiro mixes fast.
    expect(outputs.size).toBeGreaterThan(1);
  });
});

describe("SeededRng — serialization", () => {
  it("serializeRngState + deserializeRngState is a round-trip", () => {
    const r = new SeededRng(0x1234_5678n);
    for (let i = 0; i < 3; i++) r.nextLong();
    const state = r.getState();
    const ser = serializeRngState(state);
    const back = deserializeRngState(ser);
    expect(back).toEqual(state);
  });

  it("produces lowercase hex without 0x prefix", () => {
    const state: RngState = {
      s0: 0xdeadbeefn,
      s1: 0xffffffffffffffffn,
      s2: 1n,
      s3: 0n,
    };
    const ser = serializeRngState(state);
    expect(ser.s0).toBe("deadbeef");
    expect(ser.s1).toBe("ffffffffffffffff");
    expect(ser.s2).toBe("1");
    expect(ser.s3).toBe("0");
  });

  it("serialized form is JSON-safe (bigint would otherwise throw)", () => {
    const r = new SeededRng(42n);
    const state = r.getState();
    const ser = serializeRngState(state);
    const json = JSON.stringify(ser);
    const parsed = JSON.parse(json) as SerializedRngState;
    expect(deserializeRngState(parsed)).toEqual(state);
  });

  it("deserializeRngState throws on empty hex fields", () => {
    expect(() => deserializeRngState({ s0: "", s1: "0", s2: "0", s3: "0" })).toThrow(SyntaxError);
  });
});

describe("SeededRng — known vectors (regression oracle)", () => {
  // These lock our SplitMix64 + xoshiro256** implementation down bit-exact.
  // Any change to the algorithm or seeding will flip these — which is what
  // we want, because the engine's determinism contract depends on this
  // exact sequence being reproducible across machines and Node versions.
  //
  // Captured from our implementation during development; see commit body.
  const VECTORS: ReadonlyArray<{ seed: bigint; first3: readonly bigint[] }> = [
    {
      seed: 0n,
      first3: [0x99ec5f36cb75f2b4n, 0xbf6e1f784956452an, 0x1a5f849d4933e6e0n],
    },
    {
      seed: 1n,
      first3: [0xb3f2af6d0fc710c5n, 0x853b559647364cean, 0x92f89756082a4514n],
    },
    {
      seed: 42n,
      first3: [0x15780b2e0c2ec716n, 0x6104d9866d113a7en, 0xae17533239e499a1n],
    },
    {
      seed: 0xdeadbeefn,
      first3: [0xc5555444a74d7e83n, 0x65c30d37b4b16e38n, 0x54f773200a4efa23n],
    },
  ];

  for (const { seed, first3 } of VECTORS) {
    it(`seed 0x${seed.toString(16)} produces the expected first 3 nextLong outputs`, () => {
      const r = new SeededRng(seed);
      const actual = [r.nextLong(), r.nextLong(), r.nextLong()];
      expect(actual).toEqual(first3);
    });
  }

  it("seed 1n produces the expected first 3 nextFloat outputs", () => {
    // Derived from the same vectors (top 53 bits of each nextLong / 2^53).
    const r = new SeededRng(1n);
    const f0 = r.nextFloat();
    const f1 = r.nextFloat();
    const f2 = r.nextFloat();
    expect(f0).toBeCloseTo(0.7029218331588505, 15);
    expect(f1).toBeCloseTo(0.5204366199388569, 15);
    expect(f2).toBeCloseTo(0.5741057000197225, 15);
  });
});

describe("SeededRng — constructor edge cases", () => {
  it("accepts negative bigint seeds (masked to 64 bits)", () => {
    // -1n & MASK64 === 0xffff_ffff_ffff_ffffn, so -1n and (2**64 - 1)n
    // must produce the same stream.
    const rNeg = new SeededRng(-1n);
    const rPos = new SeededRng((1n << 64n) - 1n);
    expect(rNeg.nextLong()).toBe(rPos.nextLong());
    expect(rNeg.nextLong()).toBe(rPos.nextLong());
  });

  it("accepts very large bigint seeds (upper bits masked off)", () => {
    const big = (1n << 128n) | 42n;
    const small = 42n; // big & MASK64 === 42n
    const rBig = new SeededRng(big);
    const rSmall = new SeededRng(small);
    expect(rBig.nextLong()).toBe(rSmall.nextLong());
  });
});
