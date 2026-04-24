// SPDX-License-Identifier: GPL-3.0-or-later
import type { CardDefinition } from "@mtg-forge-ts/core";
import { describe, expect, it } from "vitest";
import { parseCard } from "../parser/assembler.js";
import { validateCard } from "./validate-card.js";
import "./zone-validator.js";

describe("zone validator", () => {
  it("accepts default battlefield zone", () => {
    const src = `${[
      "Name:T",
      "ManaCost:R",
      "Types:Creature Human",
      "PT:1/1",
      "S:Mode$ Continuous | Affected$ Creature.YouCtrl | AddPower$ 1 | AddToughness$ 1",
    ].join("\n")}\n`;
    const card = parseCard(src, "t.txt");
    expect(validateCard(card).ok).toBe(true);
  });

  it("accepts explicit EffectZone$ All", () => {
    const src = `${["Name:T", "Types:Enchantment", "S:Mode$ CantBeCast | ValidCard$ Card.Self | EffectZone$ All"].join("\n")}\n`;
    const card = parseCard(src, "t.txt");
    expect(validateCard(card).ok).toBe(true);
  });

  it("flags unknown zone names in hand-constructed statics", () => {
    const card = parseCard("Name:T\nTypes:Instant\n", "t.txt");
    const bad = {
      ...card,
      statics: [{ mode: "Continuous", params: {}, activeInZones: ["valhalla"] }],
    } as unknown as CardDefinition;
    const res = validateCard(bad);
    expect(res.ok).toBe(false);
    expect(res.issues.some((i) => i.message.includes("valhalla"))).toBe(true);
  });
});
