// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from "vitest";
import { parseCard } from "../parser/assembler.js";
import { validateCard } from "./validate-card.js";
import "./mana-cost-validator.js"; // self-registers

describe("mana-cost validator", () => {
  it("accepts valid mana cost 'R'", () => {
    const card = parseCard("Name:Bolt\nManaCost:R\nTypes:Instant\n", "bolt.txt");
    expect(validateCard(card).ok).toBe(true);
  });
  it("accepts hybrid mana costs", () => {
    const card = parseCard("Name:X\nManaCost:W/U\nTypes:Instant\n", "x.txt");
    expect(validateCard(card).ok).toBe(true);
  });
  it("accepts 'no cost' sentinel", () => {
    const card = parseCard("Name:Morph\nManaCost:no cost\nTypes:Creature Human\n", "morph.txt");
    expect(validateCard(card).ok).toBe(true);
  });
  it("accepts generic + colored '3 W W'", () => {
    const card = parseCard("Name:Serra\nManaCost:3 W W\nTypes:Creature Angel\nPT:4/4\n", "serra.txt");
    expect(validateCard(card).ok).toBe(true);
  });
});
