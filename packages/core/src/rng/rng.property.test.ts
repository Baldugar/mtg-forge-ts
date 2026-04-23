// SPDX-License-Identifier: GPL-3.0-or-later
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { SeededRng } from "./index.js";

// Multiset helper: shuffle invariance means the sorted-by-string multiset
// is equal before and after.  Using string keys avoids depending on the
// element type being comparable.
function multiset<T>(arr: readonly T[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const v of arr) {
    const k = JSON.stringify(v) ?? "undefined";
    m.set(k, (m.get(k) ?? 0) + 1);
  }
  return m;
}

describe("SeededRng — properties", () => {
  it("shuffle is always a permutation of the input", () => {
    fc.assert(
      fc.property(fc.bigUintN(64), fc.array(fc.integer(), { maxLength: 64 }), (seed, arr) => {
        const r = new SeededRng(seed);
        const shuffled = r.shuffle(arr);
        expect(shuffled.length).toBe(arr.length);
        expect(multiset(shuffled)).toEqual(multiset(arr));
      }),
      { numRuns: 200 },
    );
  });

  it("same seed reproduces the same nextLong and nextFloat", () => {
    fc.assert(
      fc.property(fc.bigIntN(64), (seed) => {
        const r1 = new SeededRng(seed);
        const r2 = new SeededRng(seed);
        for (let i = 0; i < 5; i++) {
          expect(r1.nextLong()).toBe(r2.nextLong());
        }
        for (let i = 0; i < 5; i++) {
          expect(r1.nextFloat()).toBe(r2.nextFloat());
        }
      }),
      { numRuns: 100 },
    );
  });

  it("shuffle preserves size and index bounds on [0, size)", () => {
    fc.assert(
      fc.property(fc.bigIntN(64), fc.integer({ min: 1, max: 1000 }), (seed, size) => {
        const arr = Array.from({ length: size }, (_, i) => i);
        const shuffled = new SeededRng(seed).shuffle(arr);
        expect(shuffled.length).toBe(size);
        for (const x of shuffled) {
          expect(x).toBeGreaterThanOrEqual(0);
          expect(x).toBeLessThan(size);
        }
        // And it's still a permutation: every index 0..size-1 appears exactly once.
        const seen = new Set(shuffled);
        expect(seen.size).toBe(size);
      }),
      { numRuns: 100 },
    );
  });

  it("nextInt results always fall within the requested half-open range", () => {
    fc.assert(
      fc.property(
        fc.bigIntN(64),
        fc.integer({ min: -1_000_000_000, max: 1_000_000_000 }),
        fc.nat({ max: 1_000_000 }),
        (seed, lo, hiDelta) => {
          const hi = lo + hiDelta + 1; // ensure hi > lo
          const r = new SeededRng(seed);
          for (let i = 0; i < 50; i++) {
            const n = r.nextInt(lo, hi);
            expect(Number.isInteger(n)).toBe(true);
            expect(n).toBeGreaterThanOrEqual(lo);
            expect(n).toBeLessThan(hi);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it("getState/setState round-trip reproduces the subsequent stream", () => {
    fc.assert(
      fc.property(
        fc.bigIntN(64),
        fc.integer({ min: 0, max: 20 }),
        fc.integer({ min: 1, max: 20 }),
        (seed, burn, tail) => {
          const r1 = new SeededRng(seed);
          for (let i = 0; i < burn; i++) r1.nextLong();
          const state = r1.getState();

          const r2 = new SeededRng(0n);
          r2.setState(state);

          for (let i = 0; i < tail; i++) {
            expect(r1.nextLong()).toBe(r2.nextLong());
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});
