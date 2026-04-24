// SPDX-License-Identifier: GPL-3.0-or-later
// Verify that importing the effects bootstrap index registers all 5 flagship effects.
import "./index.js";
import { describe, expect, it } from "vitest";
import { effectRegistry } from "../effect-registry.js";

describe("Effect suite self-register bootstrap", () => {
  it("DealDamage is registered", () => {
    expect(effectRegistry.has("DealDamage")).toBe(true);
  });

  it("Draw is registered", () => {
    expect(effectRegistry.has("Draw")).toBe(true);
  });

  it("Destroy is registered", () => {
    expect(effectRegistry.has("Destroy")).toBe(true);
  });

  it("GainLife is registered", () => {
    expect(effectRegistry.has("GainLife")).toBe(true);
  });

  it("LoseLife is registered", () => {
    expect(effectRegistry.has("LoseLife")).toBe(true);
  });
});
