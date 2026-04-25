// SPDX-License-Identifier: GPL-3.0-or-later
// Bootstrap test — verifies that importing index.ts registers all five
// concrete TriggerHandler subclasses with the triggerHandlerRegistry.
// Wave 1: ChangesZone, Phase.
// Wave 2: Attacks, SpellCast, DamageDone.
//
// NOTE: This test intentionally does NOT clear the registry between tests.
// The index.ts side-effect import runs once at module-load time; subsequent
// clears would leave the registry empty since the module is already cached
// and won't re-execute. Each it() in this file reads a registry state that
// was set up at import time and is stable for the lifetime of the test file.
import { triggerHandlerRegistry } from "../trigger-handler-registry.js";

// Side-effect import — registers all handlers at module-load time.
import "./index.js";
import { describe, expect, it } from "vitest";

describe("TriggerHandler bootstrap (index.ts)", () => {
  describe("Wave 1 handlers", () => {
    it("registers ChangesZone", () => {
      expect(triggerHandlerRegistry.has("ChangesZone")).toBe(true);
    });

    it("registers Phase", () => {
      expect(triggerHandlerRegistry.has("Phase")).toBe(true);
    });
  });

  describe("Wave 2 handlers", () => {
    it("registers Attacks", () => {
      expect(triggerHandlerRegistry.has("Attacks")).toBe(true);
    });

    it("registers SpellCast", () => {
      expect(triggerHandlerRegistry.has("SpellCast")).toBe(true);
    });

    it("registers DamageDone", () => {
      expect(triggerHandlerRegistry.has("DamageDone")).toBe(true);
    });
  });

  describe("Wave 6 handlers", () => {
    it("registers AttackersDeclared", () => {
      expect(triggerHandlerRegistry.has("AttackersDeclared")).toBe(true);
    });

    it("registers Blocks", () => {
      expect(triggerHandlerRegistry.has("Blocks")).toBe(true);
    });
  });

  describe("Wave 7 handlers", () => {
    it("registers AttackerBlocked", () => {
      expect(triggerHandlerRegistry.has("AttackerBlocked")).toBe(true);
    });

    it("registers AttackerBlockedByCreature", () => {
      expect(triggerHandlerRegistry.has("AttackerBlockedByCreature")).toBe(true);
    });

    it("registers TurnFaceUp", () => {
      expect(triggerHandlerRegistry.has("TurnFaceUp")).toBe(true);
    });
  });
});
