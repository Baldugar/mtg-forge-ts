// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from "vitest";
import { lex } from "./lexer.js";
import { parseStaticLine } from "./static-line.js";

const first = <T>(arr: readonly T[]): T => {
  if (arr.length === 0) throw new Error("empty array");
  return arr[0] as T;
};

describe("parseStaticLine", () => {
  it("parses Continuous static with default zone Battlefield", () => {
    const out = parseStaticLine(
      first(
        lex(
          "S:Mode$ Continuous | Affected$ Creature.Other+YouCtrl | AddPower$ 1 | AddToughness$ 1 | Description$ Other creatures you control get +1/+1.\n",
        ),
      ),
    );
    expect(out.mode).toBe("Continuous");
    expect(out.activeInZones).toEqual(["battlefield"]);
  });

  it("parses CantBeCast with EffectZone override 'All'", () => {
    const out = parseStaticLine(first(lex("S:Mode$ CantBeCast | ValidCard$ Card.Self | EffectZone$ All\n")));
    expect(out.mode).toBe("CantBeCast");
    expect(out.activeInZones).toEqual(["all"]);
  });

  it("rejects unknown StaticAbilityMode", () => {
    expect(() => parseStaticLine(first(lex("S:Mode$ NotAThing\n")))).toThrow(/unknown StaticAbilityMode/);
  });

  it("normalizes Mode$ case ('continuous' -> 'Continuous')", () => {
    const out = parseStaticLine(first(lex("S:Mode$ continuous | Affected$ Creature.YouCtrl\n")));
    expect(out.mode).toBe("Continuous");
  });
});
