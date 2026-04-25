// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from "vitest";
import { lex } from "./lexer.js";
import { parseStaticLine } from "./static-line.js";

const first = <T>(arr: readonly T[]): T => {
  if (arr.length === 0) throw new Error("empty array");
  return arr[0] as T;
};

const at = <T>(arr: readonly T[], i: number): T => {
  const v = arr[i];
  if (v === undefined) throw new Error(`no element at index ${i}`);
  return v;
};

// parseStaticLine now returns readonly StaticAst[] (one per comma-separated mode).
describe("parseStaticLine", () => {
  it("parses Continuous static with default zone Battlefield", () => {
    const results = parseStaticLine(
      first(
        lex(
          "S:Mode$ Continuous | Affected$ Creature.Other+YouCtrl | AddPower$ 1 | AddToughness$ 1 | Description$ Other creatures you control get +1/+1.\n",
        ),
      ),
    );
    expect(results).toHaveLength(1);
    const out = at(results, 0);
    expect(out.mode).toBe("Continuous");
    expect(out.activeInZones).toEqual(["battlefield"]);
  });

  it("parses CantBeCast with EffectZone override 'All'", () => {
    const results = parseStaticLine(
      first(lex("S:Mode$ CantBeCast | ValidCard$ Card.Self | EffectZone$ All\n")),
    );
    expect(results).toHaveLength(1);
    const out = at(results, 0);
    expect(out.mode).toBe("CantBeCast");
    expect(out.activeInZones).toEqual(["all"]);
  });

  it("rejects unknown StaticAbilityMode", () => {
    expect(() => parseStaticLine(first(lex("S:Mode$ NotAThing\n")))).toThrow(/unknown StaticAbilityMode/);
  });

  it("normalizes Mode$ case ('continuous' -> 'Continuous')", () => {
    const results = parseStaticLine(first(lex("S:Mode$ continuous | Affected$ Creature.YouCtrl\n")));
    expect(results).toHaveLength(1);
    expect(at(results, 0).mode).toBe("Continuous");
  });

  it("splits comma-separated Mode$ into multiple StaticAsts", () => {
    const results = parseStaticLine(first(lex("S:Mode$ CantAttack,CantBlock | ValidCard$ Card.Self\n")));
    expect(results).toHaveLength(2);
    expect(at(results, 0).mode).toBe("CantAttack");
    expect(at(results, 1).mode).toBe("CantBlock");
    // Both share the same params.
    expect(at(results, 0).params).toEqual(at(results, 1).params);
  });

  it("still returns a single-element array for non-comma Mode$", () => {
    const results = parseStaticLine(first(lex("S:Mode$ Continuous\n")));
    expect(results).toHaveLength(1);
  });
});
