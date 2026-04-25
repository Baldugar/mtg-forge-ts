// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from "vitest";
import { parseCard } from "./assembler.js";

describe("parseCard — multi-face", () => {
  it("parses a DFC (Delver of Secrets // Insectile Aberration) using bare ALTERNATE", () => {
    // Forge DFC format: AlternateMode:DoubleFaced is metadata on the front face;
    // bare ALTERNATE is the actual multi-face separator.
    const source = `${[
      "Name:Delver of Secrets",
      "ManaCost:U",
      "Types:Creature Human Wizard",
      "PT:1/1",
      "AlternateMode:DoubleFaced",
      "Oracle:At the beginning of your upkeep...",
      "ALTERNATE",
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

  it("parses a split card (Fire // Ice) using bare ALTERNATE", () => {
    const source = `${[
      "Name:Fire",
      "ManaCost:1 R",
      "Types:Instant",
      "A:SP$ DealDamage | Cost$ 1 R | NumDmg$ 2 | ValidTgts$ Any",
      "AlternateMode:Split",
      "Oracle:Fire deals 2 damage divided as you choose among one or two targets.",
      "ALTERNATE",
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

  it("parses a DFC using bare ALTERNATE separator", () => {
    const source = `${[
      "Name:Aberrant Researcher",
      "ManaCost:3 U",
      "Types:Creature Human Insect",
      "PT:3/2",
      "K:Flying",
      "Oracle:Flying",
      "ALTERNATE",
      "Name:Perfected Form",
      "ManaCost:no cost",
      "Colors:blue",
      "Types:Creature Insect Horror",
      "PT:5/4",
      "Oracle:",
    ].join("\n")}\n`;
    const card = parseCard(source, "aberrant_researcher.txt");
    expect(card.name).toBe("Aberrant Researcher");
    expect(card.faces).toHaveLength(1);
    expect(card.faces?.[0]?.name).toBe("Perfected Form");
  });

  it("single-face card has no faces[]", () => {
    const source =
      "Name:Lightning Bolt\nManaCost:R\nTypes:Instant\nA:SP$ DealDamage | Cost$ R | NumDmg$ 3 | ValidTgts$ Any\nOracle:x\n";
    const card = parseCard(source, "x.txt");
    expect(card.faces).toBeUndefined();
  });
});
