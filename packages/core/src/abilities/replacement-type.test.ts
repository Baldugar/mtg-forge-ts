// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from "vitest";
import { REPLACEMENT_TYPES, type ReplacementType, replacementTypeFromName } from "./replacement-type.js";

describe("ReplacementType", () => {
  it("enumerates 39 Forge replacement kinds", () => {
    expect(REPLACEMENT_TYPES).toHaveLength(39);
  });

  it("includes all CR 614-relevant kinds", () => {
    const required: ReplacementType[] = [
      "AddCounter",
      "AssembleContraption",
      "AssignDealDamage",
      "Attached",
      "BeginPhase",
      "BeginTurn",
      "Cascade",
      "Counter",
      "CopySpell",
      "CreateToken",
      "DamageDone",
      "DealtDamage",
      "DeclareBlocker",
      "Destroy",
      "Draw",
      "DrawCards",
      "Explore",
      "GainLife",
      "GameLoss",
      "GameWin",
      "Learn",
      "LifeReduced",
      "LoseMana",
      "Mill",
      "Moved",
      "PayLife",
      "PlanarDiceResult",
      "Planeswalk",
      "ProduceMana",
      "Proliferate",
      "RemoveCounter",
      "RollDice",
      "RollPlanarDice",
      "Scry",
      "SetInMotion",
      "Tap",
      "Transform",
      "TurnFaceUp",
      "Untap",
    ];
    for (const r of required) expect(REPLACEMENT_TYPES).toContain(r);
  });

  it("parses Event$ line value case-insensitively", () => {
    expect(replacementTypeFromName("Moved")).toBe("Moved");
    expect(replacementTypeFromName("moved")).toBe("Moved");
    expect(replacementTypeFromName("DAMAGEDONE")).toBe("DamageDone");
    expect(replacementTypeFromName("NotAType")).toBeNull();
  });
});
