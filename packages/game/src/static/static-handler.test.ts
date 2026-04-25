// SPDX-License-Identifier: GPL-3.0-or-later
// Wave 6 — static-handler framework registry tests. Verifies register/lookup
// round-trip and that the registry rejects empty modes (defence against the
// "subclass forgot static override" copy-paste error).
import type { StaticAbility, StaticAbilityMode, StaticAst } from "@mtg-forge-ts/core";
import { ZoneType, mkEntityId, mkPlayerSeat } from "@mtg-forge-ts/core";
import { describe, expect, it } from "vitest";
import { StaticHandler, type StaticHandlerCtx, staticHandlerRegistry } from "./static-handler.js";

class DummyHandler extends StaticHandler {
  static override readonly mode: StaticAbilityMode = "Continuous";
  override build(_ast: StaticAst, ctx: StaticHandlerCtx): StaticAbility {
    return {
      id: ctx.staticId,
      kind: "static",
      sourceCardId: ctx.sourceCardId,
      activeInZones: new Set([ZoneType.Battlefield]),
      timestamp: 1,
      controllerSeatAtReg: ctx.controllerSeat,
      category: "continuous",
      mode: DummyHandler.mode,
      describe: () => null,
    };
  }
}

describe("staticHandlerRegistry (Wave 6)", () => {
  it("registers and looks up by mode", () => {
    staticHandlerRegistry.register(DummyHandler);
    const Cls = staticHandlerRegistry.lookup("Continuous");
    expect(Cls).toBe(DummyHandler);
  });

  it("returns undefined for an unregistered mode", () => {
    // "Devotion" is intentionally unregistered in this test environment.
    expect(staticHandlerRegistry.lookup("Devotion")).toBeUndefined();
  });

  it("rejects a class with empty mode", () => {
    class Bad extends StaticHandler {
      static override readonly mode = "" as unknown as StaticAbilityMode;
      override build(_ast: StaticAst, ctx: StaticHandlerCtx): StaticAbility {
        return {
          id: ctx.staticId,
          kind: "static",
          sourceCardId: ctx.sourceCardId,
          activeInZones: new Set(),
          timestamp: 0,
          controllerSeatAtReg: ctx.controllerSeat,
          category: "continuous",
          mode: "Continuous",
          describe: () => null,
        };
      }
    }
    expect(() => staticHandlerRegistry.register(Bad)).toThrow(/mode must be non-empty/);
  });

  it("returns the live built StaticAbility from a handler instance", () => {
    staticHandlerRegistry.register(DummyHandler);
    const Cls = staticHandlerRegistry.lookup("Continuous");
    if (!Cls) throw new Error("DummyHandler not registered");
    const inst = new Cls();
    const built = inst.build(
      { mode: "Continuous", params: {}, activeInZones: [ZoneType.Battlefield] },
      {
        game: undefined as never, // not used by DummyHandler
        sourceCardId: mkEntityId(1),
        controllerSeat: mkPlayerSeat(0),
        staticId: mkEntityId(99),
      },
    );
    expect(built.id).toBe(mkEntityId(99));
    expect(built.kind).toBe("static");
    expect(built.category).toBe("continuous");
  });
});
