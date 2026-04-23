// SPDX-License-Identifier: GPL-3.0-or-later
// Property-based tests for ColorSet algebraic laws. Union is commutative,
// associative, idempotent; isSubsetOf is reflexive and respects union;
// toJSON/fromJSON round-trips preserve identity.
//
// Reviewer C §4: these laws are the foundation every downstream color-math
// helper (ManaCost.colors, protection/devotion/color-identity, etc.) leans
// on. Per-operand example tests can't cover all bit combinations — 2^5 = 32
// subsets, and two/three-operand laws need 32^2 / 32^3 pairs. A property
// test plus fast-check's shrinking catches violations that enumeration
// would miss.
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { Color, ColorSet } from "./color.js";

const ALL_COLORS: readonly Color[] = [Color.White, Color.Blue, Color.Black, Color.Red, Color.Green];

// Arbitrary ColorSet built from an arbitrary subset of the five Colors.
// fc.subarray preserves order; ColorSet.of normalizes via bit-OR anyway, so
// the generator covers every one of the 32 possible bit patterns.
const arbColorSet = fc
  .subarray(ALL_COLORS)
  .map((colors) => (colors.length === 0 ? ColorSet.empty() : ColorSet.of(...colors)));

describe("ColorSet algebraic properties", () => {
  it("union is commutative: A ∪ B = B ∪ A", () => {
    fc.assert(
      fc.property(arbColorSet, arbColorSet, (a, b) => {
        return a.union(b).equals(b.union(a));
      }),
      { numRuns: 200 },
    );
  });

  it("union is associative: (A ∪ B) ∪ C = A ∪ (B ∪ C)", () => {
    fc.assert(
      fc.property(arbColorSet, arbColorSet, arbColorSet, (a, b, c) => {
        return a
          .union(b)
          .union(c)
          .equals(a.union(b.union(c)));
      }),
      { numRuns: 200 },
    );
  });

  it("union is idempotent: A ∪ A = A", () => {
    fc.assert(
      fc.property(arbColorSet, (a) => a.union(a).equals(a)),
      { numRuns: 100 },
    );
  });

  it("empty is the identity for union: A ∪ ∅ = A", () => {
    fc.assert(
      fc.property(arbColorSet, (a) => {
        const e = ColorSet.empty();
        return a.union(e).equals(a) && e.union(a).equals(a);
      }),
      { numRuns: 100 },
    );
  });

  it("intersect is commutative and idempotent", () => {
    fc.assert(
      fc.property(arbColorSet, arbColorSet, (a, b) => {
        return a.intersect(b).equals(b.intersect(a));
      }),
      { numRuns: 200 },
    );
    fc.assert(
      fc.property(arbColorSet, (a) => a.intersect(a).equals(a)),
      { numRuns: 100 },
    );
  });

  it("A is a subset of A ∪ B for any A, B", () => {
    fc.assert(
      fc.property(arbColorSet, arbColorSet, (a, b) => a.isSubsetOf(a.union(b))),
      { numRuns: 200 },
    );
  });

  it("A is a subset of A (reflexivity)", () => {
    fc.assert(
      fc.property(arbColorSet, (a) => a.isSubsetOf(a)),
      { numRuns: 100 },
    );
  });

  it("∅ is a subset of every ColorSet", () => {
    fc.assert(
      fc.property(arbColorSet, (a) => ColorSet.empty().isSubsetOf(a)),
      { numRuns: 100 },
    );
  });

  it("A ∩ B ⊆ A and A ∩ B ⊆ B", () => {
    fc.assert(
      fc.property(arbColorSet, arbColorSet, (a, b) => {
        const ab = a.intersect(b);
        return ab.isSubsetOf(a) && ab.isSubsetOf(b);
      }),
      { numRuns: 200 },
    );
  });

  it("toJSON round-trips: fromJSON(toJSON(s)).equals(s)", () => {
    fc.assert(
      fc.property(arbColorSet, (s) => ColorSet.fromJSON(s.toJSON()).equals(s)),
      { numRuns: 200 },
    );
  });

  it("size matches the popcount of the underlying bits", () => {
    fc.assert(
      fc.property(arbColorSet, (s) => {
        // Derive expected popcount from toJSON bits.
        let b = s.toJSON();
        let n = 0;
        while (b) {
          n += b & 1;
          b >>>= 1;
        }
        return s.size === n;
      }),
      { numRuns: 100 },
    );
  });

  it("equals is reflexive, symmetric, and transitive across random triples", () => {
    // Equality is bit-equality; assert the three relation properties so a
    // future refactor to structural equality can't silently introduce
    // asymmetry.
    fc.assert(
      fc.property(arbColorSet, arbColorSet, arbColorSet, (a, b, c) => {
        if (!a.equals(a)) return false; // reflexive
        if (a.equals(b) !== b.equals(a)) return false; // symmetric
        if (a.equals(b) && b.equals(c) && !a.equals(c)) return false; // transitive
        return true;
      }),
      { numRuns: 200 },
    );
  });
});

describe("ColorSet.fromJSON validation", () => {
  it("rejects bit patterns outside the W/U/B/R/G mask", () => {
    // WHY: a 6th bit would silently widen the type if fromJSON didn't
    // validate. Bit 5 (=32) corresponds to ManaAtom.COLORLESS in the atom
    // namespace but is NOT a color bit here.
    expect(() => ColorSet.fromJSON(32)).toThrow(RangeError);
    expect(() => ColorSet.fromJSON(64)).toThrow(RangeError);
    expect(() => ColorSet.fromJSON(-1)).toThrow(RangeError);
    expect(() => ColorSet.fromJSON(1.5)).toThrow(RangeError);
  });
});
