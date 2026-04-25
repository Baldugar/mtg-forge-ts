// SPDX-License-Identifier: GPL-3.0-or-later
// Verify that importing the effects bootstrap index registers all effects.
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

  // Part D Wave 2 effects
  it("Pump is registered", () => {
    expect(effectRegistry.has("Pump")).toBe(true);
  });

  it("Counter is registered", () => {
    expect(effectRegistry.has("Counter")).toBe(true);
  });

  it("Attach is registered", () => {
    expect(effectRegistry.has("Attach")).toBe(true);
  });

  it("Fight is registered", () => {
    expect(effectRegistry.has("Fight")).toBe(true);
  });

  // Part D Wave 3 effects
  it("Token is registered", () => {
    expect(effectRegistry.has("Token")).toBe(true);
  });

  it("Animate is registered", () => {
    expect(effectRegistry.has("Animate")).toBe(true);
  });

  it("PumpAll is registered", () => {
    expect(effectRegistry.has("PumpAll")).toBe(true);
  });

  // Part D Wave 4 effects
  it("Mana is registered", () => {
    expect(effectRegistry.has("Mana")).toBe(true);
  });

  it("DestroyAll is registered", () => {
    expect(effectRegistry.has("DestroyAll")).toBe(true);
  });

  it("DamageAll is registered", () => {
    expect(effectRegistry.has("DamageAll")).toBe(true);
  });

  it("Regenerate is registered", () => {
    expect(effectRegistry.has("Regenerate")).toBe(true);
  });

  it("ChangeZoneAll is registered", () => {
    expect(effectRegistry.has("ChangeZoneAll")).toBe(true);
  });

  // Part D Wave 5 effects
  it("Charm is registered", () => {
    expect(effectRegistry.has("Charm")).toBe(true);
  });

  it("Effect is registered", () => {
    expect(effectRegistry.has("Effect")).toBe(true);
  });

  it("Dig is registered", () => {
    expect(effectRegistry.has("Dig")).toBe(true);
  });

  // Wave 6 effects
  it("GainControl is registered", () => {
    expect(effectRegistry.has("GainControl")).toBe(true);
  });

  it("PreventDamage is registered", () => {
    expect(effectRegistry.has("PreventDamage")).toBe(true);
  });

  it("ChooseCard is registered", () => {
    expect(effectRegistry.has("ChooseCard")).toBe(true);
  });

  it("CopyPermanent is registered", () => {
    expect(effectRegistry.has("CopyPermanent")).toBe(true);
  });

  // Wave 7 effects
  it("SetState is registered", () => {
    expect(effectRegistry.has("SetState")).toBe(true);
  });

  it("PutCounterAll is registered", () => {
    expect(effectRegistry.has("PutCounterAll")).toBe(true);
  });

  it("ChooseSource is registered", () => {
    expect(effectRegistry.has("ChooseSource")).toBe(true);
  });

  // Wave 8b effects
  it("AnimateAll is registered", () => {
    expect(effectRegistry.has("AnimateAll")).toBe(true);
  });

  it("ChooseColor is registered", () => {
    expect(effectRegistry.has("ChooseColor")).toBe(true);
  });

  it("Play is registered", () => {
    expect(effectRegistry.has("Play")).toBe(true);
  });

  it("RepeatEach is registered", () => {
    expect(effectRegistry.has("RepeatEach")).toBe(true);
  });

  it("PeekAndReveal is registered", () => {
    expect(effectRegistry.has("PeekAndReveal")).toBe(true);
  });

  // Wave 10 effects
  it("RevealHand is registered", () => {
    expect(effectRegistry.has("RevealHand")).toBe(true);
  });

  it("ChooseType is registered", () => {
    expect(effectRegistry.has("ChooseType")).toBe(true);
  });

  it("Branch is registered", () => {
    expect(effectRegistry.has("Branch")).toBe(true);
  });

  it("FlipACoin is registered", () => {
    expect(effectRegistry.has("FlipACoin")).toBe(true);
  });

  it("Surveil is registered", () => {
    expect(effectRegistry.has("Surveil")).toBe(true);
  });
});
