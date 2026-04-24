// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from "vitest";
import { parseCard } from "./assembler.js";

describe("parseCard — multi-face", () => {
  it("parses a DFC (Delver of Secrets // Insectile Aberration)", () => {
    const source = `${[
      "Name:Delver of Secrets",
      "ManaCost:U",
      "Types:Creature Human Wizard",
      "PT:1/1",
      "Oracle:At the beginning of your upkeep...",
      "AlternateMode:DoubleFaced",
      "Name:Insectile Aberration",
      "Types:Creature Human Insect",
      "PT:3/2",
      "K:Flying",
      "Oracle:",
    ].join("\n")}\n`;
    const card = parseCard(source, "delver.txt");
    expect(card.name).toBe("Delver of Secrets");
    expect(card.faces).toHaveLength(1);
    expect(card.faces?.[0]?.name).toBe("Insectile Aberration");
    expect(card.faces?.[0]?.keywords).toHaveLength(1);
  });

  it("parses a split card (Fire // Ice)", () => {
    const source = `${[
      "Name:Fire",
      "ManaCost:1 R",
      "Types:Instant",
      "A:SP$ DealDamage | Cost$ 1 R | NumDmg$ 2 | ValidTgts$ Any",
      "Oracle:Fire deals 2 damage divided as you choose among one or two targets.",
      "AlternateMode:Split",
      "Name:Ice",
      "ManaCost:1 U",
      "Types:Instant",
      "A:SP$ Tap | Cost$ 1 U | ValidTgts$ Permanent",
      "Oracle:Tap target permanent. Draw a card.",
    ].join("\n")}\n`;
    const card = parseCard(source, "fire_ice.txt");
    expect(card.name).toBe("Fire");
    expect(card.faces?.[0]?.name).toBe("Ice");
  });

  it("single-face card has no faces[]", () => {
    const source =
      "Name:Lightning Bolt\nManaCost:R\nTypes:Instant\nA:SP$ DealDamage | Cost$ R | NumDmg$ 3 | ValidTgts$ Any\nOracle:x\n";
    const card = parseCard(source, "x.txt");
    expect(card.faces).toBeUndefined();
  });
});
