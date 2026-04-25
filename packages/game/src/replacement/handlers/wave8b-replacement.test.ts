// SPDX-License-Identifier: GPL-3.0-or-later
// Wave 8b replacement handler registration tests.
import { describe, expect, it } from "vitest";
import { replacementHandlerRegistry } from "../replacement-handler-registry.js";

// Side-effect import registers all handlers.
import "../index.js";

describe("Wave 8b ReplacementHandler registrations", () => {
  it("Counter handler is registered", () => {
    expect(replacementHandlerRegistry.has("Counter")).toBe(true);
  });

  it("CreateToken handler is registered", () => {
    expect(replacementHandlerRegistry.has("CreateToken")).toBe(true);
  });

  it("AddCounter handler is registered", () => {
    expect(replacementHandlerRegistry.has("AddCounter")).toBe(true);
  });

  it("Draw handler is registered", () => {
    expect(replacementHandlerRegistry.has("Draw")).toBe(true);
  });
});
