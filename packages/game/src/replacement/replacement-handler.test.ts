// SPDX-License-Identifier: GPL-3.0-or-later
// Task 1 — ReplacementHandler base class + registry unit tests.
import type { ReplacementAbility, ReplacementAst } from "@mtg-forge-ts/core";
import { ZoneType, mkEntityId, mkPlayerSeat } from "@mtg-forge-ts/core";
import { afterEach, describe, expect, it } from "vitest";
import { replacementHandlerRegistry } from "./replacement-handler-registry.js";
import type { ReplacementBuildContext } from "./replacement-handler.js";
import { ReplacementHandler } from "./replacement-handler.js";

// --- Fake concrete handler for testing ---

class FakeEventReplacement extends ReplacementHandler {
  static override readonly eventKind = "FakeEvent";
  override build(_ast: ReplacementAst, ctx: ReplacementBuildContext): ReplacementAbility {
    return {
      id: ctx.replacementId,
      kind: "replacement",
      sourceCardId: ctx.sourceCardId,
      activeInZones: new Set([ZoneType.Battlefield]),
      timestamp: 0,
      controllerSeatAtReg: ctx.controllerSeat,
      isSelfReplacement: false,
      layer: "other",
      matches: () => false,
      apply: (intent) => intent,
    };
  }
}

// Another handler to verify multi-registration
class AnotherEventReplacement extends ReplacementHandler {
  static override readonly eventKind = "AnotherEvent";
  override build(_ast: ReplacementAst, ctx: ReplacementBuildContext): ReplacementAbility {
    return {
      id: ctx.replacementId,
      kind: "replacement",
      sourceCardId: ctx.sourceCardId,
      activeInZones: new Set([ZoneType.Battlefield]),
      timestamp: 0,
      controllerSeatAtReg: ctx.controllerSeat,
      isSelfReplacement: false,
      layer: "other",
      matches: () => false,
      apply: (intent) => intent,
    };
  }
}

// Restore registry state after each test to avoid cross-test pollution
afterEach(() => {
  replacementHandlerRegistry.clear();
});

describe("ReplacementHandlerRegistry", () => {
  it("register + lookup returns the registered class", () => {
    replacementHandlerRegistry.register(FakeEventReplacement);
    const cls = replacementHandlerRegistry.lookup("FakeEvent");
    expect(cls).toBe(FakeEventReplacement);
  });

  it("lookup returns undefined for unregistered eventKind", () => {
    expect(replacementHandlerRegistry.lookup("NonExistent")).toBeUndefined();
  });

  it("has() returns true after registration", () => {
    replacementHandlerRegistry.register(FakeEventReplacement);
    expect(replacementHandlerRegistry.has("FakeEvent")).toBe(true);
  });

  it("has() returns false for unregistered eventKind", () => {
    expect(replacementHandlerRegistry.has("FakeEvent")).toBe(false);
  });

  it("supports multiple registrations for different eventKinds", () => {
    replacementHandlerRegistry.register(FakeEventReplacement);
    replacementHandlerRegistry.register(AnotherEventReplacement);
    expect(replacementHandlerRegistry.has("FakeEvent")).toBe(true);
    expect(replacementHandlerRegistry.has("AnotherEvent")).toBe(true);
  });

  it("throws on registration with empty eventKind", () => {
    class BadHandler extends ReplacementHandler {
      // Intentionally not overriding `eventKind` — inherits the empty string
      override build(_ast: ReplacementAst, _ctx: ReplacementBuildContext): ReplacementAbility {
        throw new Error("unreachable");
      }
    }
    expect(() => replacementHandlerRegistry.register(BadHandler)).toThrow(/eventKind must be non-empty/);
  });

  it("instantiating the looked-up constructor produces a handler instance", () => {
    replacementHandlerRegistry.register(FakeEventReplacement);
    const Cls = replacementHandlerRegistry.lookup("FakeEvent");
    expect(Cls).toBeDefined();
    if (!Cls) return;
    const handler = new Cls();
    expect(handler).toBeInstanceOf(ReplacementHandler);
    expect(handler).toBeInstanceOf(FakeEventReplacement);
  });

  it("build() from the handler returns a ReplacementAbility with correct shape", () => {
    replacementHandlerRegistry.register(FakeEventReplacement);
    const Cls = replacementHandlerRegistry.lookup("FakeEvent");
    expect(Cls).toBeDefined();
    if (!Cls) return;
    const handler = new Cls();
    const ast: ReplacementAst = {
      eventKind: "FakeEvent",
      params: {},
      effect: { handlerKey: "ReplTest", params: {} },
    };
    const ctx: ReplacementBuildContext = {
      game: {} as never,
      sourceCardId: mkEntityId(10),
      controllerSeat: mkPlayerSeat(0),
      replacementId: mkEntityId(99),
    };
    const ra = handler.build(ast, ctx);
    expect(ra.kind).toBe("replacement");
    expect(ra.id).toBe(mkEntityId(99));
    expect(ra.sourceCardId).toBe(mkEntityId(10));
    expect(ra.isSelfReplacement).toBe(false);
    expect(ra.layer).toBe("other");
  });
});
