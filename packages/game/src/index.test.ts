// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from "vitest";
import { GAME_VERSION, LINKED_CORE_VERSION } from "./index.js";

describe("game smoke", () => {
  it("links to core", () => {
    expect(GAME_VERSION).toBe("0.0.0");
    expect(LINKED_CORE_VERSION).toBe("0.0.0");
  });
});
