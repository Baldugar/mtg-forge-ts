// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from "vitest";
import { parseCard } from "./assembler.js";

describe("intra-card reference resolution", () => {
  it("accepts when SVar is defined", () => {
    const source = `${[
      "Name:Mulldrifter",
      "ManaCost:4 U",
      "Types:Creature Elemental",
      "PT:2/2",
      "K:Flying",
      "T:Mode$ ChangesZone | Origin$ Any | Destination$ Battlefield | ValidCard$ Card.Self | Execute$ TrigDraw",
      "SVar:TrigDraw:DB$ Draw | NumCards$ 2",
    ].join("\n")}\n`;
    const card = parseCard(source, "mulldrifter.txt");
    expect(card.svars.get("TrigDraw")).toBeDefined();
  });

  it("throws when SubAbility$ references unknown SVar (DB prefix)", () => {
    const source = `${[
      "Name:Broken",
      "Types:Instant",
      "A:SP$ DealDamage | Cost$ R | NumDmg$ 1 | ValidTgts$ Any | SubAbility$ DBMissing",
    ].join("\n")}\n`;
    expect(() => parseCard(source, "broken.txt")).toThrow(/DBMissing/);
  });

  it("throws when a trigger Execute$ references unknown SVar", () => {
    const source = `${[
      "Name:Broken",
      "Types:Creature Human",
      "PT:1/1",
      "T:Mode$ ChangesZone | Origin$ Any | Destination$ Battlefield | Execute$ DBMissingTrig",
    ].join("\n")}\n`;
    expect(() => parseCard(source, "broken.txt")).toThrow(/DBMissingTrig/);
  });

  it("does NOT throw for synthetic 'Prevent' handlerKey on prevention-style replacement", () => {
    // R:Event$ DamageDone | Layer$ CantHappen | ... produces handlerKey "Prevent"
    // which is a synthetic sentinel and must not be validated against svars.
    const source = `${[
      "Name:Abrupt Decay",
      "ManaCost:B G",
      "Types:Instant",
      "R:Event$ DamageDone | Layer$ CantHappen | ValidCard$ Card.Self",
    ].join("\n")}\n`;
    expect(() => parseCard(source, "abrupt_decay.txt")).not.toThrow();
  });

  it("throws when param svarRef (X) is used without the SVar defined", () => {
    const source = `${[
      "Name:Broken",
      "ManaCost:X R",
      "Types:Sorcery",
      "A:SP$ DealDamage | Cost$ X R | NumDmg$ X | ValidTgts$ Any",
    ].join("\n")}\n`;
    // Since classifyParamValue classifies "X" as svarRef but no SVar:X exists,
    // this should throw.
    expect(() => parseCard(source, "broken.txt")).toThrow(/unresolved reference 'X'/);
  });
});
