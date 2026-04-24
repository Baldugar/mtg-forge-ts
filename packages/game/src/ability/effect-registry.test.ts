// SPDX-License-Identifier: GPL-3.0-or-later
import { afterEach, describe, expect, it } from "vitest";
import type { EngineYield } from "../action/engine-yield.js";
import type { Game } from "../game.js";
import { effectRegistry } from "./effect-registry.js";
import { SpellAbilityEffect } from "./spell-ability-effect.js";
import type { SpellAbility } from "./spell-ability.js";

// Fake effect for registry tests
class FakeEffect extends SpellAbilityEffect {
  static override readonly handlerKey = "Fake";
  // biome-ignore lint/correctness/useYield: test stub
  override *resolve(_sa: SpellAbility, _game: Game): Generator<EngineYield, void, unknown> {
    return;
  }
}

afterEach(() => {
  effectRegistry.clear();
});

describe("EffectRegistry", () => {
  it("register + lookup by key returns the same constructor", () => {
    effectRegistry.register(FakeEffect);
    expect(effectRegistry.lookup("Fake")).toBe(FakeEffect);
  });

  it("has() returns true for registered key", () => {
    effectRegistry.register(FakeEffect);
    expect(effectRegistry.has("Fake")).toBe(true);
  });

  it("has() returns false for unregistered key", () => {
    expect(effectRegistry.has("NonExistent")).toBe(false);
  });

  it("lookup returns undefined for unregistered key", () => {
    expect(effectRegistry.lookup("NonExistent")).toBeUndefined();
  });

  it("register throws if handlerKey is empty", () => {
    class BadEffect extends SpellAbilityEffect {
      static override readonly handlerKey = "";
      // biome-ignore lint/correctness/useYield: test stub
      override *resolve(_sa: SpellAbility, _game: Game): Generator<EngineYield, void, unknown> {
        return;
      }
    }
    expect(() => effectRegistry.register(BadEffect)).toThrow("handlerKey empty");
  });

  it("constructed instance from lookup has a resolve method", () => {
    effectRegistry.register(FakeEffect);
    const Cls = effectRegistry.lookup("Fake");
    expect(Cls).toBeDefined();
    if (!Cls) return;
    const instance = new Cls();
    expect(typeof instance.resolve).toBe("function");
  });
});
