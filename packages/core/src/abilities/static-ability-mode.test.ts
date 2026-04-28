// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from "vitest";
import {
  STATIC_ABILITY_MODES,
  type StaticAbilityMode,
  staticAbilityModeCategory,
  staticAbilityModeFromName,
} from "./static-ability-mode.js";
import type { StaticAbilityCategory } from "./static-ability.js";

describe("StaticAbilityMode", () => {
  it("enumerates 96 Forge modes", () => {
    expect(STATIC_ABILITY_MODES).toHaveLength(96);
  });

  it("every mode maps to exactly one StaticAbilityCategory", () => {
    for (const mode of STATIC_ABILITY_MODES) {
      const m: StaticAbilityMode = mode;
      const cat: StaticAbilityCategory = staticAbilityModeCategory(m);
      expect(cat).toBeTruthy();
    }
  });

  it("Continuous maps to continuous category", () => {
    expect(staticAbilityModeCategory("Continuous")).toBe("continuous");
  });

  it("CantDraw maps to replacementGenerating (not cantMustMay)", () => {
    expect(staticAbilityModeCategory("CantDraw")).toBe("replacementGenerating");
  });

  it("CantAttack maps to cantMustMay (action filter)", () => {
    expect(staticAbilityModeCategory("CantAttack")).toBe("cantMustMay");
  });

  it("RaiseCost/ReduceCost/SetCost map to costModification", () => {
    expect(staticAbilityModeCategory("RaiseCost")).toBe("costModification");
    expect(staticAbilityModeCategory("ReduceCost")).toBe("costModification");
    expect(staticAbilityModeCategory("SetCost")).toBe("costModification");
  });

  it("AlternativeCost maps to alternativeCost", () => {
    expect(staticAbilityModeCategory("AlternativeCost")).toBe("alternativeCost");
  });

  it("parses Mode$ line value case-insensitively", () => {
    expect(staticAbilityModeFromName("continuous")).toBe("Continuous");
    expect(staticAbilityModeFromName("CANTDRAW")).toBe("CantDraw");
    expect(staticAbilityModeFromName("NotARealMode")).toBeNull();
  });
});
