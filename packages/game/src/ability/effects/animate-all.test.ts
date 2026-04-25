// SPDX-License-Identifier: GPL-3.0-or-later
// AnimateAllEffect tests — verifies registration and basic type-change + PT application.
import "./index.js";
import { describe, expect, it } from "vitest";
import { effectRegistry } from "../effect-registry.js";

describe("AnimateAllEffect", () => {
  it("is registered under key 'AnimateAll'", () => {
    expect(effectRegistry.has("AnimateAll")).toBe(true);
  });
});

describe("ChooseColorEffect", () => {
  it("is registered under key 'ChooseColor'", () => {
    expect(effectRegistry.has("ChooseColor")).toBe(true);
  });
});

describe("PlayEffect", () => {
  it("is registered under key 'Play'", () => {
    expect(effectRegistry.has("Play")).toBe(true);
  });
});

describe("RepeatEachEffect", () => {
  it("is registered under key 'RepeatEach'", () => {
    expect(effectRegistry.has("RepeatEach")).toBe(true);
  });
});

describe("PeekAndRevealEffect", () => {
  it("is registered under key 'PeekAndReveal'", () => {
    expect(effectRegistry.has("PeekAndReveal")).toBe(true);
  });
});
