// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from "vitest";
import { CARDS_VERSION } from "./index.js";

describe("@mtg-forge-ts/cards", () => {
  it("exposes a version constant", () => {
    expect(CARDS_VERSION).toBe("0.0.0");
  });
});
