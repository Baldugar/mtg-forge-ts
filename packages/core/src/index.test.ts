// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from "vitest";
import { CORE_VERSION } from "./index.js";

describe("core smoke", () => {
  it("exposes CORE_VERSION", () => {
    expect(CORE_VERSION).toBe("0.0.0");
  });
});
