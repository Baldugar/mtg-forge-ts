// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from "vitest";
import { parseCard } from "../parser/assembler.js";
import { validateCard } from "./validate-card.js";
import "./svar-selector-validator.js";
import { KNOWN_SVAR_SELECTORS, isKnownSvarSelector } from "./svar-selector-kinds.js";

describe("svar selector validator", () => {
  it("exposes a set of known selectors", () => {
    expect(KNOWN_SVAR_SELECTORS.has("Count")).toBe(true);
    expect(KNOWN_SVAR_SELECTORS.has("Number")).toBe(true);
    expect(isKnownSvarSelector("NotARealKind")).toBe(false);
  });

  it("does not flag known selectors", () => {
    const src = `${[
      "Name:Fireball",
      "ManaCost:X R",
      "Types:Sorcery",
      "A:SP$ DealDamage | Cost$ X R | NumDmg$ X | ValidTgts$ Any",
      "SVar:X:Count$xPaid",
    ].join("\n")}\n`;
    const card = parseCard(src, "fireball.txt");
    const res = validateCard(card);
    expect(res.ok).toBe(true);
    const unknownWarnings = res.issues.filter((i) => i.message.includes("unknown SVar selector"));
    expect(unknownWarnings).toEqual([]);
  });

  it("emits a warning for unknown selector kind", () => {
    const src = `${[
      "Name:Test",
      "Types:Instant",
      "A:SP$ Draw | Cost$ U | NumCards$ 1",
      "SVar:X:NotARealKind$argx",
    ].join("\n")}\n`;
    const card = parseCard(src, "test.txt");
    const res = validateCard(card);
    expect(res.ok).toBe(true); // warning, not error
    expect(res.issues.some((i) => i.severity === "warning" && i.message.includes("NotARealKind"))).toBe(true);
  });
});
