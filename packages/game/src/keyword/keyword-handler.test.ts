// SPDX-License-Identifier: GPL-3.0-or-later
// Task 1 — KeywordHandler base class + registry unit tests.
import type { KeywordAst } from "@mtg-forge-ts/core";
import { afterEach, describe, expect, it } from "vitest";
import { keywordHandlerRegistry } from "./keyword-handler-registry.js";
import type { KeywordActivationContext } from "./keyword-handler.js";
import { KeywordHandler } from "./keyword-handler.js";

// ---------------------------------------------------------------------------
// Fake concrete handlers for testing
// ---------------------------------------------------------------------------

class FlyingKeywordHandler extends KeywordHandler {
  static override readonly keyword = "flying";
  override activate(_ast: KeywordAst, _ctx: KeywordActivationContext): void {
    // no-op for testing
  }
}

class TrampleKeywordHandler extends KeywordHandler {
  static override readonly keyword = "trample";
  override activate(_ast: KeywordAst, _ctx: KeywordActivationContext): void {
    // no-op for testing
  }
}

class FallbackKeywordHandler extends KeywordHandler {
  static override readonly keyword = "*";
  override activate(_ast: KeywordAst, _ctx: KeywordActivationContext): void {
    // no-op for testing
  }
}

// Restore registry state after each test to avoid cross-test pollution
afterEach(() => {
  keywordHandlerRegistry.clear();
});

describe("KeywordHandlerRegistry", () => {
  it("register + lookup returns the registered class", () => {
    keywordHandlerRegistry.register(FlyingKeywordHandler);
    const cls = keywordHandlerRegistry.lookup("flying");
    expect(cls).toBe(FlyingKeywordHandler);
  });

  it("lookup returns undefined for unregistered keyword (no fallback)", () => {
    expect(keywordHandlerRegistry.lookup("warp")).toBeUndefined();
  });

  it("has() returns true after registration", () => {
    keywordHandlerRegistry.register(FlyingKeywordHandler);
    expect(keywordHandlerRegistry.has("flying")).toBe(true);
  });

  it("has() returns false for unregistered keyword (no fallback)", () => {
    expect(keywordHandlerRegistry.has("flying")).toBe(false);
  });

  it("supports multiple registrations for different keywords", () => {
    keywordHandlerRegistry.register(FlyingKeywordHandler);
    keywordHandlerRegistry.register(TrampleKeywordHandler);
    expect(keywordHandlerRegistry.has("flying")).toBe(true);
    expect(keywordHandlerRegistry.has("trample")).toBe(true);
  });

  it("throws on registration with empty keyword", () => {
    class BadHandler extends KeywordHandler {
      // Intentionally not overriding `keyword` — inherits the empty string
      override activate(_ast: KeywordAst, _ctx: KeywordActivationContext): void {
        throw new Error("unreachable");
      }
    }
    expect(() => keywordHandlerRegistry.register(BadHandler)).toThrow(/keyword must be non-empty/);
  });

  it("register fallback ('*') → lookup of unknown keyword returns fallback", () => {
    keywordHandlerRegistry.register(FallbackKeywordHandler);
    const cls = keywordHandlerRegistry.lookup("warp");
    expect(cls).toBe(FallbackKeywordHandler);
  });

  it("register fallback ('*') → has() returns true for unregistered keyword", () => {
    keywordHandlerRegistry.register(FallbackKeywordHandler);
    expect(keywordHandlerRegistry.has("warp")).toBe(true);
    expect(keywordHandlerRegistry.has("trample")).toBe(true);
  });

  it("specific handler takes priority over fallback", () => {
    keywordHandlerRegistry.register(FallbackKeywordHandler);
    keywordHandlerRegistry.register(FlyingKeywordHandler);
    expect(keywordHandlerRegistry.lookup("flying")).toBe(FlyingKeywordHandler);
    expect(keywordHandlerRegistry.lookup("warp")).toBe(FallbackKeywordHandler);
  });

  it("instantiating the looked-up constructor produces a handler instance", () => {
    keywordHandlerRegistry.register(FlyingKeywordHandler);
    const Cls = keywordHandlerRegistry.lookup("flying");
    expect(Cls).toBeDefined();
    if (!Cls) return;
    const handler = new Cls();
    expect(handler).toBeInstanceOf(KeywordHandler);
    expect(handler).toBeInstanceOf(FlyingKeywordHandler);
  });
});
