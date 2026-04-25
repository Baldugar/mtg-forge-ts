// SPDX-License-Identifier: GPL-3.0-or-later
// Task 1 — TriggerHandler base class + registry unit tests.
import type { TriggerAst, TriggeredAbility } from "@mtg-forge-ts/core";
import { ZoneType, mkEntityId, mkPlayerSeat } from "@mtg-forge-ts/core";
import { afterEach, describe, expect, it } from "vitest";
import { triggerHandlerRegistry } from "./trigger-handler-registry.js";
import type { TriggerBuildContext } from "./trigger-handler.js";
import { TriggerHandler } from "./trigger-handler.js";

// --- Fake concrete handler for testing ---

class FakeModeTrigger extends TriggerHandler {
  static override readonly mode = "FakeMode";
  override build(_ast: TriggerAst, ctx: TriggerBuildContext): TriggeredAbility {
    return {
      id: ctx.triggerId,
      kind: "triggered",
      sourceCardId: ctx.sourceCardId,
      activeInZones: new Set([ZoneType.Battlefield]),
      timestamp: 0,
      controllerSeatAtReg: ctx.controllerSeat,
      matches: () => true,
      isDelayed: false,
    };
  }
}

// Another handler to verify multi-registration
class AnotherModeTrigger extends TriggerHandler {
  static override readonly mode = "AnotherMode";
  override build(_ast: TriggerAst, ctx: TriggerBuildContext): TriggeredAbility {
    return {
      id: ctx.triggerId,
      kind: "triggered",
      sourceCardId: ctx.sourceCardId,
      activeInZones: new Set([ZoneType.Battlefield]),
      timestamp: 0,
      controllerSeatAtReg: ctx.controllerSeat,
      matches: () => false,
      isDelayed: false,
    };
  }
}

// Restore registry state after each test to avoid cross-test pollution
afterEach(() => {
  triggerHandlerRegistry.clear();
});

describe("TriggerHandlerRegistry", () => {
  it("register + lookup returns the registered class", () => {
    triggerHandlerRegistry.register(FakeModeTrigger);
    const cls = triggerHandlerRegistry.lookup("FakeMode");
    expect(cls).toBe(FakeModeTrigger);
  });

  it("lookup returns undefined for unregistered mode", () => {
    expect(triggerHandlerRegistry.lookup("NonExistent")).toBeUndefined();
  });

  it("has() returns true after registration", () => {
    triggerHandlerRegistry.register(FakeModeTrigger);
    expect(triggerHandlerRegistry.has("FakeMode")).toBe(true);
  });

  it("has() returns false for unregistered mode", () => {
    expect(triggerHandlerRegistry.has("FakeMode")).toBe(false);
  });

  it("supports multiple registrations for different modes", () => {
    triggerHandlerRegistry.register(FakeModeTrigger);
    triggerHandlerRegistry.register(AnotherModeTrigger);
    expect(triggerHandlerRegistry.has("FakeMode")).toBe(true);
    expect(triggerHandlerRegistry.has("AnotherMode")).toBe(true);
  });

  it("throws on registration with empty mode", () => {
    class BadHandler extends TriggerHandler {
      // Intentionally not overriding `mode` — inherits the empty string
      override build(_ast: TriggerAst, _ctx: TriggerBuildContext): TriggeredAbility {
        throw new Error("unreachable");
      }
    }
    expect(() => triggerHandlerRegistry.register(BadHandler)).toThrow(/mode must be non-empty/);
  });

  it("instantiating the looked-up constructor produces a handler instance", () => {
    triggerHandlerRegistry.register(FakeModeTrigger);
    const Cls = triggerHandlerRegistry.lookup("FakeMode");
    expect(Cls).toBeDefined();
    if (!Cls) return;
    const handler = new Cls();
    expect(handler).toBeInstanceOf(TriggerHandler);
    expect(handler).toBeInstanceOf(FakeModeTrigger);
  });

  it("build() from the handler returns a TriggeredAbility with correct shape", () => {
    triggerHandlerRegistry.register(FakeModeTrigger);
    const Cls = triggerHandlerRegistry.lookup("FakeMode");
    expect(Cls).toBeDefined();
    if (!Cls) return;
    const handler = new Cls();
    const ast: TriggerAst = {
      mode: "FakeMode",
      params: {},
      effect: { handlerKey: "TrigTest", params: {} },
    };
    const ctx: TriggerBuildContext = {
      game: {} as never,
      sourceCardId: mkEntityId(10),
      controllerSeat: mkPlayerSeat(0),
      triggerId: mkEntityId(99),
    };
    const ta = handler.build(ast, ctx);
    expect(ta.kind).toBe("triggered");
    expect(ta.id).toBe(mkEntityId(99));
    expect(ta.sourceCardId).toBe(mkEntityId(10));
    expect(ta.isDelayed).toBe(false);
  });
});
