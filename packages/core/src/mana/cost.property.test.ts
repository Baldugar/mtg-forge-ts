// SPDX-License-Identifier: GPL-3.0-or-later
// Property-based tests for ManaCost:
//   - toJSON → fromJSON round-trips as identity.
//   - cmc distributes over combine: cmc(combine(a,b), x) === cmc(a,x) + cmc(b,x).
//   - colors distributes over combine: colors(combine(a,b)) === colors(a) ∪ colors(b).
//   - toForgeString / fromForgeString preserves the Forge-relevant invariants
//     (hasNoCost, total genericCost, non-generic shard-count-per-kind, colors,
//     and cmc) — see the hand-written round-trip test for why the shape is
//     not strictly identity-preserving (Forge collapses generic shards).
//
// Reviewer C §4: property tests catch bit-pattern bugs in the symbol-count
// and color-extraction code that example tests miss when the author didn't
// imagine the specific combination.
import fc from "fast-check";
import { describe, it } from "vitest";
import { Color, ColorSet } from "../color.js";
import { ManaCost } from "./cost.js";
import type { ManaSymbol } from "./symbol.js";

const ALL_COLORS: readonly Color[] = [Color.White, Color.Blue, Color.Black, Color.Red, Color.Green];

// Arbitrary single ManaSymbol — matches every discriminant in the union.
// Distribution is uniform-over-kinds to get balanced coverage. "coloredX"
// is included because toJSON must round-trip it even though the text parser
// can't produce it.
const arbSymbol: fc.Arbitrary<ManaSymbol> = fc.oneof(
  fc.nat({ max: 16 }).map((n) => ({ kind: "generic" as const, amount: n })),
  fc
    .constantFrom("X" as const, "Y" as const, "Z" as const)
    .map((letter) => ({ kind: "variable" as const, letter })),
  fc.constantFrom(...ALL_COLORS).map((color) => ({ kind: "colored" as const, color })),
  fc.constant({ kind: "colorless" as const }),
  fc.constant({ kind: "snow" as const }),
  fc
    .tuple(fc.constantFrom(...ALL_COLORS), fc.constantFrom(...ALL_COLORS))
    .filter(([a, b]) => a !== b)
    .map(([a, b]) => ({ kind: "hybrid" as const, a, b })),
  fc
    .constantFrom(...ALL_COLORS)
    .map((color) => ({ kind: "monoHybrid" as const, generic: 2 as const, color })),
  fc.constantFrom(...ALL_COLORS).map((color) => ({ kind: "phyrexian" as const, color })),
  fc.constantFrom(...ALL_COLORS).map((color) => ({ kind: "colorlessHybrid" as const, color })),
  fc
    .tuple(fc.constantFrom(...ALL_COLORS), fc.constantFrom(...ALL_COLORS))
    .filter(([a, b]) => a !== b)
    .map(([a, b]) => ({ kind: "hybridPhyrexian" as const, a, b })),
  fc.constant({ kind: "coloredX" as const }),
);

// Arbitrary ManaCost: random-length symbol list + random hasNoCost flag.
// WHY: generate symbols directly (bypassing parse) so properties exercise
// every shard kind, including coloredX which no text parse produces.
const arbManaCost: fc.Arbitrary<ManaCost> = fc
  .tuple(fc.array(arbSymbol, { maxLength: 8 }), fc.boolean())
  .map(([symbols, hasNoCost]) => new ManaCost(symbols, hasNoCost && symbols.length === 0));

// Cmc reference implementation — used to cross-check class semantics.
const refCmc = (c: ManaCost, x: number): number => {
  let total = 0;
  for (const s of c.symbols) {
    switch (s.kind) {
      case "generic":
        total += s.amount;
        break;
      case "variable":
      case "coloredX":
        total += x;
        break;
      case "monoHybrid":
        total += 2;
        break;
      default:
        total += 1;
        break;
    }
  }
  return total;
};

const refColors = (c: ManaCost): ColorSet => {
  const colors: Color[] = [];
  for (const s of c.symbols) {
    switch (s.kind) {
      case "colored":
      case "monoHybrid":
      case "phyrexian":
      case "colorlessHybrid":
        colors.push(s.color);
        break;
      case "hybrid":
      case "hybridPhyrexian":
        colors.push(s.a, s.b);
        break;
      default:
        break;
    }
  }
  return colors.length === 0 ? ColorSet.empty() : ColorSet.of(...colors);
};

describe("ManaCost algebraic properties", () => {
  it("toJSON round-trips as identity", () => {
    fc.assert(
      fc.property(arbManaCost, (c) => {
        const j = c.toJSON();
        const restored = ManaCost.fromJSON(j);
        // Symbol lists must be structurally equal and flags must match.
        if (restored.hasNoCost !== c.hasNoCost) return false;
        if (restored.symbols.length !== c.symbols.length) return false;
        for (let i = 0; i < c.symbols.length; i++) {
          if (JSON.stringify(restored.symbols[i]) !== JSON.stringify(c.symbols[i])) return false;
        }
        return true;
      }),
      { numRuns: 200 },
    );
  });

  it("cmc distributes over combine: cmc(combine(a,b), x) = cmc(a,x) + cmc(b,x)", () => {
    fc.assert(
      fc.property(arbManaCost, arbManaCost, fc.nat({ max: 20 }), (a, b, x) => {
        const ab = ManaCost.combine(a, b);
        return ab.cmc(x) === a.cmc(x) + b.cmc(x);
      }),
      { numRuns: 200 },
    );
  });

  it("cmc matches the reference implementation for any x", () => {
    fc.assert(
      fc.property(arbManaCost, fc.nat({ max: 20 }), (c, x) => {
        return c.cmc(x) === refCmc(c, x);
      }),
      { numRuns: 200 },
    );
  });

  it("colors distributes over combine: colors(combine(a,b)) = colors(a) ∪ colors(b)", () => {
    fc.assert(
      fc.property(arbManaCost, arbManaCost, (a, b) => {
        const ab = ManaCost.combine(a, b);
        return ab.colors().equals(a.colors().union(b.colors()));
      }),
      { numRuns: 200 },
    );
  });

  it("colors matches the reference implementation", () => {
    fc.assert(
      fc.property(arbManaCost, (c) => c.colors().equals(refColors(c))),
      { numRuns: 200 },
    );
  });

  it("combine preserves hasNoCost=false (Forge combine behavior)", () => {
    fc.assert(
      fc.property(arbManaCost, arbManaCost, (a, b) => ManaCost.combine(a, b).hasNoCost === false),
      { numRuns: 200 },
    );
  });

  it("genericCost distributes over combine", () => {
    fc.assert(
      fc.property(arbManaCost, arbManaCost, (a, b) => {
        return ManaCost.combine(a, b).genericCost() === a.genericCost() + b.genericCost();
      }),
      { numRuns: 200 },
    );
  });

  it("Forge wire-format round-trip preserves cmc, colors, hasNoCost, and per-kind non-generic counts", () => {
    // WHY: toForgeString collapses every generic shard into a single prefix,
    // so symbol-identity isn't preserved. The Forge-relevant invariants are.
    const nonGenericKinds: ReadonlyArray<ManaSymbol["kind"]> = [
      "variable",
      "colored",
      "colorless",
      "snow",
      "hybrid",
      "monoHybrid",
      "phyrexian",
      "colorlessHybrid",
      "hybridPhyrexian",
      "coloredX",
    ];
    fc.assert(
      fc.property(arbManaCost, fc.nat({ max: 10 }), (c, x) => {
        // WHY: Forge flattens Y/Z to X in the wire format (our extension),
        // so cost instances that contain Y/Z don't preserve shardCount("variable")
        // via toForgeString → fromForgeString. The wire-format doc calls
        // this out explicitly; skip those samples here.
        for (const s of c.symbols) {
          if (s.kind === "variable" && s.letter !== "X") return true;
        }
        const wire = c.toForgeString();
        const back = ManaCost.fromForgeString(wire);
        if (back.hasNoCost !== c.hasNoCost) return false;
        if (back.cmc(x) !== c.cmc(x)) return false;
        if (!back.colors().equals(c.colors())) return false;
        if (back.genericCost() !== c.genericCost()) return false;
        for (const k of nonGenericKinds) {
          if (back.shardCount(k) !== c.shardCount(k)) return false;
        }
        return true;
      }),
      { numRuns: 200 },
    );
  });
});
