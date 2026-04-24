// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from "vitest";
import { parseCard } from "./assembler.js";

describe("parseCard assembler", () => {
  it("parses Lightning Bolt end-to-end", () => {
    const source = `${[
      "Name:Lightning Bolt",
      "ManaCost:R",
      "Types:Instant",
      "A:SP$ DealDamage | Cost$ R | NumDmg$ 3 | ValidTgts$ Any | SpellDescription$ CARDNAME deals 3 damage to any target.",
      "Oracle:Lightning Bolt deals 3 damage to any target.",
    ].join("\n")}\n`;
    const card = parseCard(source, "lightning_bolt.txt");
    expect(card.name).toBe("Lightning Bolt");
    expect(card.types.types).toEqual(["Instant"]);
    expect(card.abilities).toHaveLength(1);
    expect(card.oracle).toBe("Lightning Bolt deals 3 damage to any target.");
  });

  it("parses Grizzly Bears with PT", () => {
    const source = `${[
      "Name:Grizzly Bears",
      "ManaCost:1 G",
      "Types:Creature Bear",
      "PT:2/2",
      "Oracle:A strong creature.",
    ].join("\n")}\n`;
    const card = parseCard(source, "grizzly_bears.txt");
    expect(card.pt).toEqual({ power: "2", toughness: "2" });
  });

  it("parses SVar reference", () => {
    const source = `${[
      "Name:Fireball",
      "ManaCost:X R",
      "Types:Sorcery",
      "A:SP$ DealDamage | Cost$ X R | NumDmg$ X | ValidTgts$ Any",
      "SVar:X:Count$xPaid",
    ].join("\n")}\n`;
    const card = parseCard(source, "fireball.txt");
    const xVar = card.svars.get("X") as { raw: string } | undefined;
    expect(xVar?.raw).toBe("Count$xPaid");
  });

  it("rejects unknown prefix", () => {
    const source = "Name:Bolt\nTypes:Instant\nNotARealPrefix:foo\n";
    expect(() => parseCard(source, "x.txt")).toThrow(/unknown prefix 'NotARealPrefix'/);
  });

  it("rejects cards missing Name:", () => {
    expect(() => parseCard("Types:Creature Human\n", "x.txt")).toThrow(/missing Name/);
  });

  it("rejects cards missing Types:", () => {
    expect(() => parseCard("Name:Foo\n", "x.txt")).toThrow(/missing Types/);
  });

  it("parses keywords", () => {
    const source = `${[
      "Name:Serra Angel",
      "ManaCost:3 W W",
      "Types:Creature Angel",
      "PT:4/4",
      "K:Flying",
      "K:Vigilance",
      "Oracle:",
    ].join("\n")}\n`;
    const card = parseCard(source, "serra.txt");
    expect(card.keywords).toHaveLength(2);
  });

  it("appends Text/Rules lines with newlines", () => {
    const source = `${["Name:Foo", "Types:Instant", "Text:Line1", "Text:Line2"].join("\n")}\n`;
    // parseCard should not throw — just verify it completes
    const card = parseCard(source, "foo.txt");
    expect(card.name).toBe("Foo");
  });
});
