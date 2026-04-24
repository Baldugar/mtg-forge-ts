// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from "vitest";
import { parseCard } from "../parser/assembler.js";
import { validateCard } from "./validate-card.js";

describe("validateCard skeleton", () => {
  it("returns ok: true for a trivially valid card", () => {
    const card = parseCard("Name:Bolt\nManaCost:R\nTypes:Instant\n", "bolt.txt");
    const res = validateCard(card);
    expect(res.ok).toBe(true);
    expect(res.issues).toEqual([]);
  });

  it("descends into faces", () => {
    const src = `${[
      "Name:A",
      "ManaCost:R",
      "Types:Instant",
      "AlternateMode:Split",
      "Name:B",
      "ManaCost:U",
      "Types:Instant",
    ].join("\n")}\n`;
    const card = parseCard(src, "ab.txt");
    const res = validateCard(card);
    expect(res.ok).toBe(true);
  });
});
