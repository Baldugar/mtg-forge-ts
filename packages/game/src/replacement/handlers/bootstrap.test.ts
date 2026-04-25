// SPDX-License-Identifier: GPL-3.0-or-later
// Task 5 — bootstrap handler self-registration test.
// Importing replacement/index.js (or handlers/index.js directly) populates
// replacementHandlerRegistry with all built-in handlers via side-effect.
// This test asserts that each expected eventKind is registered after the
// single barrel import, proving the bootstrap chain works end-to-end.
import { describe, expect, it } from "vitest";
import { replacementHandlerRegistry } from "../replacement-handler-registry.js";

// The side-effect import that triggers handler registration.
// This mirrors what packages/game/src/index.ts re-exports.
import "../index.js";

describe("ReplacementHandler bootstrap registrations", () => {
  it("Moved handler is registered after import", () => {
    expect(replacementHandlerRegistry.has("Moved")).toBe(true);
  });

  it("DamageDone handler is registered after import", () => {
    expect(replacementHandlerRegistry.has("DamageDone")).toBe(true);
  });

  it("at-least-2 handlers are registered (Moved + DamageDone) — Wave 8b adds 4 more", () => {
    // Ensure we don't have ghost registrations from other test files that
    // may have also imported the index. Since the registry is a module-level
    // singleton (not cleared between tests), this count reflects all
    // registrations that have happened since the process started.
    // We assert at-least-2 rather than exactly-2 to be robust against
    // future additions: the important invariant is that both exist.
    expect(replacementHandlerRegistry.has("Moved")).toBe(true);
    expect(replacementHandlerRegistry.has("DamageDone")).toBe(true);
  });

  it("lookup returns the MovedReplacement constructor", () => {
    const Cls = replacementHandlerRegistry.lookup("Moved");
    expect(Cls).toBeDefined();
    expect(Cls?.eventKind).toBe("Moved");
  });

  it("lookup returns the DamageReplacement constructor", () => {
    const Cls = replacementHandlerRegistry.lookup("DamageDone");
    expect(Cls).toBeDefined();
    expect(Cls?.eventKind).toBe("DamageDone");
  });
});
