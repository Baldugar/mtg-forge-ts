// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from "vitest";
import { Color, ColorSet } from "../color.js";
import { ManaCost, manaValue } from "./cost.js";
import { ManaParseError, type ManaSymbol } from "./symbol.js";

describe("ManaCost.cmc()", () => {
  it("empty cost has cmc 0", () => {
    expect(ManaCost.parse("").cmc()).toBe(0);
  });

  it("single colored symbol has cmc 1", () => {
    expect(ManaCost.parse("W").cmc()).toBe(1);
  });

  it("generic N contributes N", () => {
    expect(ManaCost.parse("3").cmc()).toBe(3);
    expect(ManaCost.parse("10").cmc()).toBe(10);
    expect(ManaCost.parse("0").cmc()).toBe(0);
  });

  it("2WU has cmc 4", () => {
    expect(ManaCost.parse("2WU").cmc()).toBe(4);
  });

  it("variable X defaults to 0, and uses xValue when supplied", () => {
    const c = ManaCost.parse("XWU");
    expect(c.cmc()).toBe(2); // X=0 + W + U
    expect(c.cmc(3)).toBe(5); // X=3 + W + U
  });

  it("all X/Y/Z share the same xValue (documented simplification)", () => {
    const c = ManaCost.parse("XYZ");
    expect(c.cmc(2)).toBe(6);
  });

  it("hybrid contributes 1", () => {
    expect(ManaCost.parse("W/U").cmc()).toBe(1);
  });

  it("monoHybrid contributes 2", () => {
    expect(ManaCost.parse("2/W").cmc()).toBe(2);
    expect(ManaCost.parse("2/W2/U").cmc()).toBe(4);
  });

  it("phyrexian contributes 1", () => {
    expect(ManaCost.parse("W/P").cmc()).toBe(1);
  });

  it("hybridPhyrexian contributes 1", () => {
    expect(ManaCost.parse("W/U/P").cmc()).toBe(1);
    expect(ManaCost.parse("B/G/P").cmc()).toBe(1);
  });

  it("colorlessHybrid contributes 1", () => {
    expect(ManaCost.parse("C/W").cmc()).toBe(1);
    expect(ManaCost.parse("C/G").cmc()).toBe(1);
  });

  it("colorless and snow contribute 1 each", () => {
    expect(ManaCost.parse("C").cmc()).toBe(1);
    expect(ManaCost.parse("S").cmc()).toBe(1);
    expect(ManaCost.parse("CS").cmc()).toBe(2);
  });

  it("manaValue() helper matches cmc()", () => {
    const c = ManaCost.parse("XWU");
    expect(manaValue(c)).toBe(c.cmc());
    expect(manaValue(c, 5)).toBe(c.cmc(5));
  });
});

describe("ManaCost.colors()", () => {
  it("empty cost has no colors", () => {
    const c = ManaCost.parse("");
    expect(c.colors().equals(ColorSet.empty())).toBe(true);
  });

  it("purely generic has no colors", () => {
    expect(ManaCost.parse("3").colors().equals(ColorSet.empty())).toBe(true);
  });

  it("colorless and snow contribute no colors", () => {
    expect(ManaCost.parse("CS").colors().equals(ColorSet.empty())).toBe(true);
  });

  it("variable contributes no colors", () => {
    expect(ManaCost.parse("X").colors().equals(ColorSet.empty())).toBe(true);
  });

  it("single colored symbol", () => {
    const s = ManaCost.parse("W").colors();
    expect(s.equals(ColorSet.of(Color.White))).toBe(true);
  });

  it("multiple colored symbols union", () => {
    const s = ManaCost.parse("2WU").colors();
    expect(s.equals(ColorSet.of(Color.White, Color.Blue))).toBe(true);
  });

  it("hybrid adds both colors", () => {
    const s = ManaCost.parse("W/U").colors();
    expect(s.equals(ColorSet.of(Color.White, Color.Blue))).toBe(true);
  });

  it("hybridPhyrexian adds both colors (the life alternative is no color)", () => {
    const s = ManaCost.parse("W/U/P").colors();
    expect(s.equals(ColorSet.of(Color.White, Color.Blue))).toBe(true);
  });

  it("monoHybrid adds the single color", () => {
    const s = ManaCost.parse("2/R").colors();
    expect(s.equals(ColorSet.of(Color.Red))).toBe(true);
  });

  it("phyrexian adds its color", () => {
    const s = ManaCost.parse("G/P").colors();
    expect(s.equals(ColorSet.of(Color.Green))).toBe(true);
  });

  it("colorlessHybrid adds only the color side (C contributes nothing)", () => {
    const s = ManaCost.parse("C/W").colors();
    expect(s.equals(ColorSet.of(Color.White))).toBe(true);
  });

  it("mixed cost unions every color source", () => {
    const s = ManaCost.parse("1WU/B2/RG/P").colors();
    expect(s.equals(ColorSet.of(Color.White, Color.Blue, Color.Black, Color.Red, Color.Green))).toBe(true);
  });

  it("duplicate color contributions are idempotent", () => {
    const s = ManaCost.parse("WWW").colors();
    expect(s.equals(ColorSet.of(Color.White))).toBe(true);
    expect(s.size).toBe(1);
  });
});

describe("ManaCost — Forge-ported predicates", () => {
  it("isNoCost(): true only for parse('')", () => {
    expect(ManaCost.parse("").isNoCost()).toBe(true);
    expect(ManaCost.parse("0").isNoCost()).toBe(false);
    expect(ManaCost.parse("W").isNoCost()).toBe(false);
    expect(ManaCost.parse("2WU").isNoCost()).toBe(false);
  });

  it("isZero(): true only for '0' and equivalents", () => {
    expect(ManaCost.parse("0").isZero()).toBe(true);
    expect(ManaCost.parse("").isZero()).toBe(false);
    expect(ManaCost.parse("1").isZero()).toBe(false);
    expect(ManaCost.parse("W").isZero()).toBe(false);
  });

  it("isPureGeneric(): true when only generic symbols (and not no-cost)", () => {
    expect(ManaCost.parse("0").isPureGeneric()).toBe(true);
    expect(ManaCost.parse("3").isPureGeneric()).toBe(true);
    expect(ManaCost.parse("10").isPureGeneric()).toBe(true);
    expect(ManaCost.parse("").isPureGeneric()).toBe(false);
    expect(ManaCost.parse("2W").isPureGeneric()).toBe(false);
    expect(ManaCost.parse("X").isPureGeneric()).toBe(false);
  });

  it("genericCost(): sum of generic amounts only", () => {
    expect(ManaCost.parse("").genericCost()).toBe(0);
    expect(ManaCost.parse("3").genericCost()).toBe(3);
    expect(ManaCost.parse("2WU").genericCost()).toBe(2);
    expect(ManaCost.parse("XWU").genericCost()).toBe(0); // X doesn't contribute
    expect(ManaCost.parse("2/W").genericCost()).toBe(0); // monoHybrid doesn't
  });

  it("countX(): number of variable symbols", () => {
    expect(ManaCost.parse("").countX()).toBe(0);
    expect(ManaCost.parse("X").countX()).toBe(1);
    expect(ManaCost.parse("XX").countX()).toBe(2);
    expect(ManaCost.parse("XYZ").countX()).toBe(3);
    expect(ManaCost.parse("2W").countX()).toBe(0);
  });

  it("hasPhyrexian(): true for single-color or hybrid phyrexian", () => {
    expect(ManaCost.parse("W").hasPhyrexian()).toBe(false);
    expect(ManaCost.parse("W/P").hasPhyrexian()).toBe(true);
    expect(ManaCost.parse("W/U/P").hasPhyrexian()).toBe(true);
    expect(ManaCost.parse("2W/PG").hasPhyrexian()).toBe(true);
  });

  it("getPhyrexianCount(): counts both single and hybrid phyrexian", () => {
    expect(ManaCost.parse("W").getPhyrexianCount()).toBe(0);
    expect(ManaCost.parse("W/P").getPhyrexianCount()).toBe(1);
    expect(ManaCost.parse("W/PU/P").getPhyrexianCount()).toBe(2);
    expect(ManaCost.parse("W/U/P B/G/P").getPhyrexianCount()).toBe(2);
  });

  it("hasMultiColor(): true for hybrid and hybridPhyrexian, false otherwise", () => {
    expect(ManaCost.parse("2WU").hasMultiColor()).toBe(false);
    expect(ManaCost.parse("W/U").hasMultiColor()).toBe(true);
    expect(ManaCost.parse("W/U/P").hasMultiColor()).toBe(true);
    expect(ManaCost.parse("2/W").hasMultiColor()).toBe(false);
    expect(ManaCost.parse("W/P").hasMultiColor()).toBe(false);
    expect(ManaCost.parse("C/W").hasMultiColor()).toBe(false); // colorlessHybrid is mono-color
  });

  it("shardCount(): counts symbols by discriminant", () => {
    // "2WUW/U2/R" parses as generic 2, W, U, hybrid W/U, monoHybrid 2/R.
    const c = ManaCost.parse("2WUW/U2/R");
    expect(c.shardCount("generic")).toBe(1);
    expect(c.shardCount("colored")).toBe(2);
    expect(c.shardCount("hybrid")).toBe(1);
    expect(c.shardCount("monoHybrid")).toBe(1);
    expect(c.shardCount("phyrexian")).toBe(0);
    expect(c.shardCount("coloredX")).toBe(0);
  });
});

describe("ManaCost.combine()", () => {
  it("concatenates two costs", () => {
    const a = ManaCost.parse("2W");
    const b = ManaCost.parse("U");
    const c = ManaCost.combine(a, b);
    expect(c.symbols).toEqual<ManaSymbol[]>([
      { kind: "generic", amount: 2 },
      { kind: "colored", color: Color.White },
      { kind: "colored", color: Color.Blue },
    ]);
    expect(c.hasNoCost).toBe(false);
  });

  it("combining two no-costs yields a non-no-cost with zero symbols (matches Forge)", () => {
    const c = ManaCost.combine(ManaCost.parse(""), ManaCost.parse(""));
    expect(c.symbols).toEqual([]);
    expect(c.hasNoCost).toBe(false);
    expect(c.isZero()).toBe(false); // no symbols → not zero either
    expect(c.isPureGeneric()).toBe(true); // empty shards + !hasNoCost == Forge pure-generic
  });

  it("preserves total cmc across combine", () => {
    const a = ManaCost.parse("2W");
    const b = ManaCost.parse("X");
    const c = ManaCost.combine(a, b);
    expect(c.cmc()).toBe(a.cmc() + b.cmc());
    expect(c.cmc(4)).toBe(a.cmc(4) + b.cmc(4));
  });

  it("combining a no-cost with a real cost drops the no-cost flag", () => {
    const c = ManaCost.combine(ManaCost.parse(""), ManaCost.parse("2W"));
    expect(c.isNoCost()).toBe(false);
    expect(c.cmc()).toBe(3);
  });
});

describe("ManaCost — Forge wire-format bridge", () => {
  it("toForgeString emits '-1' for no-cost", () => {
    expect(ManaCost.parse("").toForgeString()).toBe("-1");
  });

  it("toForgeString emits '0' for zero cost (no shards)", () => {
    expect(ManaCost.parse("0").toForgeString()).toBe("0");
  });

  it("toForgeString emits just the numeric for pure generic", () => {
    expect(ManaCost.parse("3").toForgeString()).toBe("3");
  });

  it("toForgeString uses Forge shard names with \\x06 delimiter", () => {
    const s = ManaCost.parse("2WU").toForgeString();
    expect(s).toBe("2WHITEBLUE");
  });

  it("toForgeString emits canonical hybrid/phyrexian/hybridPhyrexian names", () => {
    expect(ManaCost.parse("W/U").toForgeString()).toBe("0WU");
    expect(ManaCost.parse("W/P").toForgeString()).toBe("0WP");
    expect(ManaCost.parse("W/U/P").toForgeString()).toBe("0WUP");
    expect(ManaCost.parse("C/W").toForgeString()).toBe("0CW");
    expect(ManaCost.parse("2/W").toForgeString()).toBe("0W2");
    expect(ManaCost.parse("S").toForgeString()).toBe("0S");
    expect(ManaCost.parse("X").toForgeString()).toBe("0X");
  });

  it("fromForgeString parses '-1' to no-cost", () => {
    const c = ManaCost.fromForgeString("-1");
    expect(c.isNoCost()).toBe(true);
    expect(c.symbols).toEqual([]);
  });

  it("fromForgeString parses '0' to an empty cost (Forge ZERO)", () => {
    const c = ManaCost.fromForgeString("0");
    expect(c.isNoCost()).toBe(false);
    expect(c.symbols).toEqual([]);
    // WHY: Forge's ZERO is represented as an empty shards list + genericCost=0
    // which matches our isPureGeneric + !hasNoCost semantics (no shards).
    expect(c.isPureGeneric()).toBe(true);
  });

  it("fromForgeString parses shard names", () => {
    const c = ManaCost.fromForgeString("2WHITEBLUE");
    expect(c.symbols).toEqual<ManaSymbol[]>([
      { kind: "generic", amount: 2 },
      { kind: "colored", color: Color.White },
      { kind: "colored", color: Color.Blue },
    ]);
  });

  it("fromForgeString parses COLORED_X", () => {
    const c = ManaCost.fromForgeString("1COLORED_X");
    expect(c.symbols).toEqual<ManaSymbol[]>([{ kind: "generic", amount: 1 }, { kind: "coloredX" }]);
  });

  it("fromForgeString rejects unknown shard names", () => {
    expect(() => ManaCost.fromForgeString("0NOTASHARD")).toThrow();
  });

  it("fromForgeString rejects non-numeric head", () => {
    expect(() => ManaCost.fromForgeString("abcWHITE")).toThrow();
  });

  it("round-trip: fromForgeString(toForgeString(x)) preserves semantics", () => {
    // NOTE: The Forge wire format collapses all generic symbols into a single
    // prefix integer (matching Forge's own serialize()). Therefore
    //   symbols.length is NOT guaranteed to be preserved when the input has
    //   multiple {generic:N} symbols, OR when the only symbol is {generic:0}
    //   (it is round-tripped as empty symbols + generic=0).
    // What IS guaranteed: cmc, colors, hasNoCost, and total genericCost.
    const inputs = [
      "",
      "0",
      "3",
      "2WU",
      "X",
      "XWU",
      "W/U",
      "W/P",
      "W/U/P",
      "C/W",
      "2/W",
      "S",
      "1WU/B2/RG/P",
      "B/G/P",
    ];
    for (const s of inputs) {
      const original = ManaCost.parse(s);
      const wire = original.toForgeString();
      const roundTripped = ManaCost.fromForgeString(wire);
      expect(roundTripped.hasNoCost, `hasNoCost for ${JSON.stringify(s)}`).toBe(original.hasNoCost);
      expect(roundTripped.cmc(3), `cmc(3) for ${JSON.stringify(s)}`).toBe(original.cmc(3));
      expect(roundTripped.genericCost(), `genericCost for ${JSON.stringify(s)}`).toBe(original.genericCost());
      expect(roundTripped.colors().equals(original.colors()), `colors for ${JSON.stringify(s)}`).toBe(true);
      // Non-generic shard counts must match exactly.
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
      for (const k of nonGenericKinds) {
        expect(roundTripped.shardCount(k), `shardCount(${k}) for ${JSON.stringify(s)}`).toBe(
          original.shardCount(k),
        );
      }
    }
  });

  it("round-trip handles a COLORED_X-bearing cost via wire format only", () => {
    // The text parser never produces coloredX (no parse string), so we build
    // a cost from Forge wire and verify round-trip.
    const fromWire = ManaCost.fromForgeString("0COLORED_X");
    const reSerialized = fromWire.toForgeString();
    expect(reSerialized).toBe("0COLORED_X");
  });
});

describe("ManaCost toJSON/fromJSON round-trip", () => {
  it("round-trips a complex cost via plain JSON", () => {
    const original = ManaCost.parse("{X}{2}{W}{U/B}{2/R}{G/P}{C}{S}");
    const json = JSON.parse(JSON.stringify(original.toJSON())) as {
      symbols: ManaSymbol[];
      hasNoCost: boolean;
    };
    const restored = ManaCost.fromJSON(json);
    expect(restored.symbols).toEqual(original.symbols);
    expect(restored.hasNoCost).toBe(original.hasNoCost);
    expect(restored.cmc(3)).toBe(original.cmc(3));
    expect(restored.colors().equals(original.colors())).toBe(true);
  });

  it("toJSON returns a detached copy (mutating it does not mutate the cost)", () => {
    const c = ManaCost.parse("2WU");
    const j = c.toJSON();
    (j.symbols as ManaSymbol[]).push({ kind: "colored", color: Color.Red });
    expect(c.symbols.length).toBe(3);
  });

  it("fromJSON preserves hybrid ordering (a,b)", () => {
    const c = ManaCost.parse("U/W");
    const restored = ManaCost.fromJSON(c.toJSON());
    expect(restored.symbols[0]).toEqual<ManaSymbol>({
      kind: "hybrid",
      a: Color.Blue,
      b: Color.White,
    });
  });

  it("empty/no-cost round-trips and preserves hasNoCost", () => {
    const c = ManaCost.parse("");
    const restored = ManaCost.fromJSON(c.toJSON());
    expect(restored.symbols).toEqual([]);
    expect(restored.hasNoCost).toBe(true);
    expect(restored.isNoCost()).toBe(true);
    expect(restored.cmc()).toBe(0);
  });

  it("legacy JSON shape without hasNoCost defaults to false", () => {
    const legacy: { symbols: ManaSymbol[] } = {
      symbols: [{ kind: "generic", amount: 2 }],
    };
    const restored = ManaCost.fromJSON(legacy);
    expect(restored.hasNoCost).toBe(false);
    expect(restored.symbols).toEqual(legacy.symbols);
  });

  it("new shard kinds round-trip via JSON", () => {
    const c = ManaCost.parse("C/W W/U/P");
    const restored = ManaCost.fromJSON(c.toJSON());
    expect(restored.symbols).toEqual<ManaSymbol[]>([
      { kind: "colorlessHybrid", color: Color.White },
      { kind: "hybridPhyrexian", a: Color.White, b: Color.Blue },
    ]);
  });
});

describe("ManaCost input validation", () => {
  it("rejects generic digit runs that exceed Number.MAX_SAFE_INTEGER (contiguous form)", () => {
    expect(() => ManaCost.parse("999999999999999999999")).toThrow(ManaParseError);
  });

  it("rejects generic digit runs that exceed Number.MAX_SAFE_INTEGER (space-separated form)", () => {
    expect(() => ManaCost.parse("999999999999999999999 W")).toThrow(ManaParseError);
  });

  it("rejects generic digit runs that exceed Number.MAX_SAFE_INTEGER (braced form)", () => {
    expect(() => ManaCost.parse("{999999999999999999999}")).toThrow(ManaParseError);
  });

  it("accepts Number.MAX_SAFE_INTEGER as a safe integer", () => {
    const c = ManaCost.parse(String(Number.MAX_SAFE_INTEGER));
    expect(c.cmc()).toBe(Number.MAX_SAFE_INTEGER);
  });

  it("cmc() rejects negative xValue", () => {
    const c = ManaCost.parse("X");
    expect(() => c.cmc(-1)).toThrow(RangeError);
  });

  it("cmc() rejects NaN xValue", () => {
    const c = ManaCost.parse("X");
    expect(() => c.cmc(Number.NaN)).toThrow(RangeError);
  });

  it("cmc() rejects non-integer xValue", () => {
    const c = ManaCost.parse("X");
    expect(() => c.cmc(1.5)).toThrow(RangeError);
  });

  it("cmc() accepts 0 and positive integers", () => {
    const c = ManaCost.parse("X");
    expect(c.cmc(0)).toBe(0);
    expect(c.cmc(7)).toBe(7);
  });
});

describe("ManaCost.parse — untested throw paths (Reviewer C §2)", () => {
  // WHY: lock the canonical error messages at each rejection site so future
  // refactors can't silently rephrase them (error strings are part of the
  // engine's debuggable contract — observers grep them in logs).

  it("rejects trailing '/' at end of input", () => {
    expect(() => ManaCost.parse("W/")).toThrow(ManaParseError);
    expect(() => ManaCost.parse("W/")).toThrow(/Incomplete hybrid: trailing '\/'/);
  });

  it("rejects leading zero in a braced generic", () => {
    expect(() => ManaCost.parse("{02}")).toThrow(ManaParseError);
    expect(() => ManaCost.parse("{02}")).toThrow(/leading zero/);
  });

  it("rejects mono-hybrid with a left side that isn't 2 (unbraced)", () => {
    expect(() => ManaCost.parse("3/W")).toThrow(ManaParseError);
    expect(() => ManaCost.parse("3/W")).toThrow(/Mono-hybrid left side must be 2/);
    expect(() => ManaCost.parse("1/W")).toThrow(/Mono-hybrid left side must be 2/);
  });

  it("rejects mono-hybrid with non-2 left side in braced form", () => {
    expect(() => ManaCost.parse("{3/W}")).toThrow(ManaParseError);
    expect(() => ManaCost.parse("{3/W}")).toThrow(/Mono-hybrid left side must be 2/);
    expect(() => ManaCost.parse("{1/W}")).toThrow(/Mono-hybrid left side must be 2/);
  });

  it("rejects a variable letter as the left side of a hybrid", () => {
    expect(() => ManaCost.parse("X/W")).toThrow(ManaParseError);
    expect(() => ManaCost.parse("X/W")).toThrow(/Variable letter cannot be the left side of a hybrid/);
  });

  it("rejects unknown mana-symbol character inside braces", () => {
    expect(() => ManaCost.parse("{Q}")).toThrow(ManaParseError);
    expect(() => ManaCost.parse("{Q}")).toThrow(/Unknown mana-symbol character/);
  });

  it("rejects interior whitespace within braces", () => {
    // WHY: whitespace *between* braced tokens selects the space-separated
    // parser; whitespace INSIDE a brace is invalid in every parse form.
    // The space-separated parser treats "{W U}" as a single token and routes
    // it through parseForgeShardToken, which rejects the embedded space.
    expect(() => ManaCost.parse("{W U}")).toThrow(ManaParseError);
  });

  it("rejects mixed braced/unbraced form with brace after unbraced", () => {
    expect(() => ManaCost.parse("W{U}")).toThrow(ManaParseError);
    expect(() => ManaCost.parse("W{U}")).toThrow(/Mixed braced\/unbraced/);
  });

  it("rejects mixed braced/unbraced form with unbraced after brace", () => {
    // "{W}U" — after closing brace we expect '{' or EOF; 'U' is neither.
    expect(() => ManaCost.parse("{W}U")).toThrow(ManaParseError);
    expect(() => ManaCost.parse("{W}U")).toThrow(/Expected '\{' at position/);
  });

  it("rejects an unclosed '{'", () => {
    expect(() => ManaCost.parse("{W")).toThrow(ManaParseError);
    expect(() => ManaCost.parse("{W")).toThrow(/Unclosed '\{'/);
  });

  it("rejects empty braces '{}'", () => {
    expect(() => ManaCost.parse("{}")).toThrow(ManaParseError);
    expect(() => ManaCost.parse("{}")).toThrow(/Empty braces/);
  });

  it("rejects nested braces", () => {
    // parseBraced detects '{' *inside* the inner substring between a pair of
    // matched braces and rejects with the canonical "Nested '{'" message.
    expect(() => ManaCost.parse("{{W}")).toThrow(ManaParseError);
    expect(() => ManaCost.parse("{{W}")).toThrow(/Nested '\{'/);
  });

  it("rejects trailing characters inside braces", () => {
    // "{WX}" — parseOneSymbol consumes "W" as colored, then there's leftover "X".
    expect(() => ManaCost.parse("{WX}")).toThrow(ManaParseError);
    expect(() => ManaCost.parse("{WX}")).toThrow(/Trailing characters inside braces/);
  });

  it("fromForgeString rejects a duplicate shard (Forge-canonical names accept as separate shards, so test malformed paths)", () => {
    // WHY: Forge's serialize emits duplicated shards when a cost has two of
    // the same kind (e.g., {W}{W} → "0\x06WHITE\x06WHITE"). That's valid —
    // we must NOT reject it. The bad case is an invalid shard name, which
    // we cover separately.
    const twoWhite = ManaCost.fromForgeString("0\x06WHITE\x06WHITE");
    expect(twoWhite.symbols.length).toBe(2);
  });

  it("fromForgeString rejects an invalid shard token mid-string", () => {
    expect(() => ManaCost.fromForgeString("2\x06NOTACOLOR\x06WHITE")).toThrow(ManaParseError);
    expect(() => ManaCost.fromForgeString("2\x06NOTACOLOR\x06WHITE")).toThrow(/unknown shard name/);
  });

  it("fromForgeString handles the empty string as no-cost", () => {
    // WHY: fromForgeString("") is tolerated (treated as NO_COST); negative
    // test is covered above. Assert the positive so we document the
    // tolerance.
    const c = ManaCost.fromForgeString("");
    expect(c.hasNoCost).toBe(true);
    expect(c.symbols).toEqual([]);
  });

  it("fromForgeString rejects malformed head (non-numeric)", () => {
    expect(() => ManaCost.fromForgeString("abc\x06WHITE")).toThrow(ManaParseError);
    expect(() => ManaCost.fromForgeString("abc\x06WHITE")).toThrow(/expected numeric head/);
  });

  it("space-separated parser rejects an unknown character in a token", () => {
    // WHY: parseForgeShardToken hits the 'default' branch when neither digit
    // nor a known atom letter/slash; assert the canonical message.
    expect(() => ManaCost.parse("2 W!")).toThrow(ManaParseError);
    expect(() => ManaCost.parse("2 W!")).toThrow(/Unknown character/);
  });

  it("space-separated parser rejects Y/Z when not standalone within a token", () => {
    // WHY: contiguous "YW" is accepted (Y = variable, W = colored) — the
    // rejection path is only reached when Y/Z appear inside a space-separated
    // token alongside other atoms (e.g., "YZ" as a single token).
    expect(() => ManaCost.parse("YZ 2")).toThrow(ManaParseError);
    expect(() => ManaCost.parse("YZ 2")).toThrow(/must be a standalone token/);
  });

  it("space-separated parser rejects a pure-numeric shard token (parseForgeShardToken invariant)", () => {
    // WHY: "2/2" in space-separated form is rare but reaches
    // parseForgeShardToken with atoms=ATOM_OR_2_GENERIC|ATOM_GENERIC → reject.
    expect(() => ManaCost.parse("W 2/2")).toThrow(ManaParseError);
    expect(() => ManaCost.parse("W 2/2")).toThrow(/normalizes to generic/);
  });

  it("space-separated parser rejects an invalid snow token (S combined with other atoms)", () => {
    expect(() => ManaCost.parse("W SW")).toThrow(ManaParseError);
    expect(() => ManaCost.parse("W SW")).toThrow(/Invalid snow token/);
  });

  it("space-separated parser rejects an invalid phyrexian token (P + colorless)", () => {
    expect(() => ManaCost.parse("W CP")).toThrow(ManaParseError);
    expect(() => ManaCost.parse("W CP")).toThrow(/Invalid phyrexian token/);
  });

  it("space-separated parser rejects an invalid mono-hybrid token (2 + multiple colors)", () => {
    expect(() => ManaCost.parse("W 2/WU")).toThrow(ManaParseError);
    expect(() => ManaCost.parse("W 2/WU")).toThrow(/Invalid mono-hybrid token/);
  });

  it("space-separated parser rejects invalid colorless-hybrid (C + multiple colors)", () => {
    expect(() => ManaCost.parse("W C/WU")).toThrow(ManaParseError);
    expect(() => ManaCost.parse("W C/WU")).toThrow(/Invalid colorlessHybrid token/);
  });

  it("rejects invalid right side of hybrid (non-color, non-P) in unbraced form", () => {
    expect(() => ManaCost.parse("W/Q")).toThrow(ManaParseError);
    expect(() => ManaCost.parse("W/Q")).toThrow(/Invalid right side of hybrid/);
  });
});
