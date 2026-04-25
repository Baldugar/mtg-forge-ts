// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from "vitest";
import { parseCard } from "./assembler.js";

describe("error messages include source location or card context", () => {
  it("tolerates unknown keyword as freeform (no throw)", () => {
    // Since unknown keywords fall back to 'freeform', they no longer throw.
    const source = `${["Name:Bogus", "Types:Creature Human", "K:NotARealKeyword"].join("\n")}\n`;
    expect(() => parseCard(source, "bogus.txt")).not.toThrow();
  });

  it("reports line number for unknown StaticAbilityMode", () => {
    const source = `${["Name:Bogus", "Types:Enchantment", "S:Mode$ NotARealMode"].join("\n")}\n`;
    expect(() => parseCard(source, "bogus.txt")).toThrow(/line 3/);
  });

  it("reports card path for resolver errors", () => {
    const source = `${[
      "Name:Bogus",
      "Types:Instant",
      "A:SP$ DealDamage | Cost$ R | NumDmg$ 1 | ValidTgts$ Any | SubAbility$ DBMissing",
    ].join("\n")}\n`;
    expect(() => parseCard(source, "bogus.txt")).toThrow(/Bogus.*DBMissing/);
  });

  it("reports file name for missing Name:", () => {
    expect(() => parseCard("Types:Creature Human\n", "bogus.txt")).toThrow(/bogus\.txt.*Name/);
  });
});
